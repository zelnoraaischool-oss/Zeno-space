/**
 * 5.1 / 5.2 認証（Supabase Auth）。
 * メールOTP（6桁のコード、またはメールのリンク）を標準にし、Google / GitHub は管理画面で有効にしたときだけ使う。
 * 1人1アカウントの判定は DB の handle_new_user()（auth.users の insert）で行う。
 */
import { ApiError } from '../errors'
import type { PendingIdentity, SignInResult } from '../mock/auth'
import type { AdminRole, IdentityKind } from '../../types'
import { normalizeEmail, HANDLE_PATTERN } from '../../normalize'
import { restrictionMessage } from '../../restrictions'
import { setAdminSession } from '../shared'
import { clearUserState, emit, state } from './store'
import { deviceHash, loadMe, loadPublic, rpc, sb, toApiError, unwatchAllRooms } from './core'
import { toRestriction } from './mappers'

/** 管理画面で有効にした外部ログイン（VITE_AUTH_PROVIDERS=google,github） */
function enabledProviders(): ('google' | 'github')[] {
  const raw = (import.meta.env.VITE_AUTH_PROVIDERS ?? '') as string
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is 'google' | 'github' => s === 'google' || s === 'github')
}

function redirectUrl(path = '/login'): string {
  return `${location.origin}${path}`
}

/** ログイン直後の確認：凍結・停止、退会の取り消し、未登録（規約同意前）、オンボーディング */
async function finishSignIn(): Promise<SignInResult> {
  const { data } = await sb().auth.getUser()
  const user = data.user
  if (!user) throw new ApiError('unauthenticated', 'ログインできませんでした。もう一度お試しください')
  const lock = await rpc<{ status: string; restriction: Record<string, unknown> | null } | null>('my_lock')
  if (lock) {
    const r = lock.restriction ? toRestriction(lock.restriction) : null
    clearUserState()
    emit()
    return { status: 'locked', reason: r ? restrictionMessage(r) : 'このアカウントは利用できません', restrictionId: r?.id ?? null }
  }
  await rpc('restore_account').catch(() => false)
  await loadMe()
  void deviceHash()
    .then((h) => rpc('record_device', { p_device_hash: h }))
    .catch(() => undefined)
  // 規約に一度も同意していない＝登録の途中（生年月と同意の入力へ）
  if (state.pendingEmail !== null) {
    emit()
    return { status: 'new_user', pending: auth.pendingSignup()! }
  }
  if (!state.me) throw new ApiError('invalid', 'アカウントを読み込めませんでした。もう一度お試しください')
  emit()
  return { status: 'signed_in', userId: state.me.id, needsOnboarding: !state.me.onboarded }
}

/** この画面で作った認証アプリの登録（QR コードは登録した時にしか受け取れないため覚えておく） */
let enrollment: { factorId: string; qr: string; secret: string } | null = null
let setupQueue: Promise<{ bootstrapNeeded: boolean; totp: { qr: string; secret: string } | null }> = Promise.resolve({ bootstrapNeeded: false, totp: null })

async function adminSetupOnce(): Promise<{ bootstrapNeeded: boolean; totp: { qr: string; secret: string } | null }> {
  if (!state.me) return { bootstrapNeeded: false, totp: null }
  const bootstrapNeeded = await rpc<boolean>('admin_bootstrap_needed')
  if (!state.adminRole) return { bootstrapNeeded, totp: null }
  const { data, error } = await sb().auth.mfa.listFactors()
  if (error) throw toApiError(error)
  if (data.totp.some((f) => f.status === 'verified')) return { bootstrapNeeded, totp: null }
  const pendingFactors = data.all.filter((x) => x.factor_type === 'totp' && x.status !== 'verified')
  if (enrollment && pendingFactors.some((f) => f.id === enrollment!.factorId))
    return { bootstrapNeeded, totp: { qr: enrollment.qr, secret: enrollment.secret } }
  // 前に途中で止まった未確認の登録は消してから作り直す
  for (const f of pendingFactors) await sb().auth.mfa.unenroll({ factorId: f.id })
  const enrolled = await sb().auth.mfa.enroll({ factorType: 'totp', friendlyName: `zenospace ${Date.now()}` })
  if (enrolled.error) throw toApiError(enrolled.error)
  enrollment = { factorId: enrolled.data.id, qr: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret }
  return { bootstrapNeeded, totp: { qr: enrollment.qr, secret: enrollment.secret } }
}

export const auth = {
  sessionUserId(): string | null {
    return state.userId
  },

  /** 使えるログイン方法（モックは Google / GitHub の画面を模したデモを出す） */
  providers(): ('google' | 'github')[] {
    return enabledProviders()
  },

  /** Google / GitHub：認証画面へ移動する（戻ってきたら URL のコードからセッションを作る） */
  async signInWithProvider(provider: 'google' | 'github', _email?: string, _displayName?: string): Promise<SignInResult> {
    void _email
    void _displayName
    const { error } = await sb().auth.signInWithOAuth({ provider, options: { redirectTo: redirectUrl('/login?oauth=1') } })
    if (error) throw toApiError(error)
    // 認証画面へ移動するので、ここから先は戻らない
    return new Promise<SignInResult>(() => {})
  },

  /** ZS-AUTH-02 メールOTP。メールには6桁のコードとログイン用のリンクが届く */
  async sendEmailOtp(email: string, inviteCode?: string): Promise<{ hint: string }> {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError('invalid', 'メールアドレスの形式が正しくありません')
    const { error } = await sb().auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true, emailRedirectTo: redirectUrl('/login'), data: inviteCode ? { invite_code: inviteCode.trim() } : undefined },
    })
    if (error) {
      if (/database error/i.test(error.message)) {
        throw new ApiError(
          'conflict',
          state.appSettings.inviteOnly
            ? '現在は招待制です。招待コードを確かめて、もう一度お試しください'
            : 'このメールアドレスでは新しいアカウントを作れません。Gmail はドットや「+」以降を除いた同じアドレスで登録済みの可能性があります。登録済みのアドレスでログインしてください',
        )
      }
      if (/rate limit|too many|seconds/i.test(error.message))
        throw new ApiError('rate_limited', '短時間に何度も送信されました。1分ほど待ってからお試しください')
      throw toApiError(error)
    }
    return { hint: 'メールが届かないときは、迷惑メールフォルダも確認してください。メールのボタンからもログインできます' }
  },

  async verifyEmailOtp(email: string, code: string): Promise<SignInResult> {
    const token = code.replace(/\s/g, '')
    if (!/^\d{6,8}$/.test(token)) throw new ApiError('invalid', 'メールに届いた確認コード（数字）を入力してください')
    const { error } = await sb().auth.verifyOtp({ email: email.trim(), token, type: 'email' })
    if (error) throw new ApiError('invalid', 'コードが正しくないか、有効期限が切れています。もう一度コードを送ってください')
    return finishSignIn()
  },

  /** メールのリンクや Google から戻ってきたとき：URL からセッションができていれば続きを行う */
  async resumeSignIn(): Promise<SignInResult | null> {
    const { data } = await sb().auth.getSession()
    if (!data.session) return null
    return finishSignIn()
  },

  /** 登録の途中（規約同意の前）なら、その情報を返す */
  pendingSignup(): PendingIdentity | null {
    const email = state.pendingEmail
    if (email === null) return null
    return { provider: 'email', email, normalized: normalizeEmail(email), displayName: email.split('@')[0] }
  },

  /** 既存アカウントへの連携は、登録済みの方法でログインしてから設定画面で行う */
  async linkAndSignIn(_pending: PendingIdentity): Promise<SignInResult> {
    void _pending
    throw new ApiError('invalid', '登録済みのログイン方法でログインしてから、設定 > アカウント で連携してください')
  },

  /** 新規登録：規約同意（ZS-AUTH-06）、年齢確認（ZS-AUTH-07） */
  async completeSignUp(input: { pending: PendingIdentity; birthYm: string; agreed: boolean; inviteCode?: string }): Promise<SignInResult> {
    if (!input.agreed) throw new ApiError('invalid', '利用規約とプライバシーポリシーへの同意が必要です')
    if (!/^\d{4}-\d{2}$/.test(input.birthYm)) throw new ApiError('invalid', '生年月を入力してください')
    await rpc('complete_signup', {
      p_birth_ym: input.birthYm,
      p_terms_version: state.appSettings.termsVersion,
      p_privacy_version: state.appSettings.privacyVersion,
    })
    await loadMe()
    emit()
    if (!state.me) throw new ApiError('invalid', 'アカウントを読み込めませんでした')
    return { status: 'signed_in', userId: state.me.id, needsOnboarding: !state.me.onboarded }
  },

  /** 凍結・停止中の異議申し立て（ログイン画面から） */
  async submitLockedAppeal(restrictionId: string, body: string): Promise<void> {
    await rpc('submit_appeal', { p_restriction: restrictionId, p_body: body })
  },

  async signOut(): Promise<void> {
    setAdminSession(null)
    unwatchAllRooms()
    await sb().auth.signOut()
    clearUserState()
    emit()
  },

  /** ZS-AUTH-04 ユーザーIDの変更（30日に1回） */
  async changeHandle(handle: string): Promise<void> {
    if (!HANDLE_PATTERN.test(handle)) throw new ApiError('invalid', 'ユーザーIDは英数字と _ の4〜20文字で入力してください')
    await rpc('change_handle', { p_handle: handle })
    await loadMe()
    emit()
  },

  linkedIdentities(): IdentityKind[] {
    return state.identities
  },

  /** Google / GitHub の連携（認証画面へ移動して戻る） */
  async linkProvider(provider: 'google' | 'github', _email?: string): Promise<void> {
    void _email
    const { error } = await sb().auth.linkIdentity({ provider, options: { redirectTo: redirectUrl('/settings/account') } })
    if (error) throw toApiError(error)
  },

  /** ZS-AUTH-09 退会申請（30日以内にログインすれば復元） */
  async requestDeletion(): Promise<void> {
    await rpc('request_account_deletion')
    await auth.signOut()
  },

  /** 規約改定時の再同意（ZS-AUTH-06） */
  needsReconsent(): boolean {
    if (!state.me) return false
    const has = (doc: 'terms' | 'privacy', v: string) => state.consents.some((c) => c.doc === doc && c.version === v)
    return !has('terms', state.appSettings.termsVersion) || !has('privacy', state.appSettings.privacyVersion)
  },

  async agreeLatestTerms(): Promise<void> {
    await rpc('agree_terms')
    await loadMe()
    emit()
  },

  // ---- 運営コンソールのログイン（A-01） ----
  adminRole(): AdminRole | null {
    return state.adminRole
  },

  /**
   * 運営ログインの準備：オーナーがまだいなければ初期設定が必要。
   * 認証アプリ（TOTP）が未登録なら、登録用の QR コードを作って返す。
   */
  async adminSetup(): Promise<{ bootstrapNeeded: boolean; totp: { qr: string; secret: string } | null }> {
    // 画面の描き直しで何度呼ばれても、登録は1つだけ作る（同時に呼ばれたら順番に処理する）
    setupQueue = setupQueue.then(adminSetupOnce, adminSetupOnce)
    return setupQueue
  },

  /** 初期設定：最初の運営オーナーになる（運営メンバーがまだいないときだけ） */
  async claimOwner(): Promise<boolean> {
    const ok = await rpc<boolean>('claim_owner')
    await loadMe()
    emit()
    return ok
  },

  /** TOTP の検証（Supabase Auth の MFA）。成功するとセッションが aal2 になり、運営の権限が有効になる */
  async verifyAdminTotp(code: string): Promise<void> {
    if (!state.me) throw new ApiError('unauthenticated', 'ログインしてください')
    if (!state.adminRole) throw new ApiError('forbidden', '運営メンバーではありません')
    if (!/^\d{6}$/.test(code.trim())) throw new ApiError('invalid', '認証アプリに表示されている6桁の数字を入力してください')
    const { data, error } = await sb().auth.mfa.listFactors()
    if (error) throw toApiError(error)
    const factor = data.totp.find((f) => f.status === 'verified') ?? data.all.find((f) => f.factor_type === 'totp')
    if (!factor) throw new ApiError('invalid', '認証アプリが登録されていません。画面を開き直してください')
    const res = await sb().auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() })
    if (res.error) throw new ApiError('invalid', '確認コードが正しくありません。認証アプリの最新のコードを入力してください')
    setAdminSession(state.me.id)
    // aal2 になると運営だけが読める設定も読めるようになる
    await Promise.all([loadMe(), loadPublic()])
    emit()
  },

  adminSignOut() {
    setAdminSession(null)
    emit()
  },

  /** 招待コードの発行（ZS-ONE-05） */
  async issueInviteCode(): Promise<string> {
    return rpc<string>('issue_invite_code')
  },
}
