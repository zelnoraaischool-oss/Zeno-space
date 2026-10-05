/**
 * 5.1 / 5.2 認証と1人1アカウント制御。
 * 本番は Supabase Auth（Google / GitHub / メールOTP）で認証し、
 * 重複判定は DB 関数 `register_identity()`（supabase/migrations）が行う。
 */
import { ApiError } from '../errors'
import { db, delay, done, currentUser, setSession, setAdminSession, adminRoleOf, notify, audit, sessionUserId } from './core'
import { normalizeEmail, HANDLE_PATTERN } from '../../normalize'
import { nowIso, uuid } from '../../ids'
import { colorFor } from '../../mock/art'
import { defaultSettings } from '../../mock/seed'
import { OFFICIAL_USER_ID } from '../../constants'
import type { IdentityKind, Profile } from '../../types'
import { activeRestrictions, restrictionMessage } from '../../restrictions'

export type Provider = 'google' | 'github' | 'email'

export interface PendingIdentity {
  provider: Provider
  email: string
  normalized: string
  displayName: string
}

export type SignInResult =
  | { status: 'signed_in'; userId: string; needsOnboarding: boolean }
  | { status: 'new_user'; pending: PendingIdentity }
  | { status: 'link_suggested'; pending: PendingIdentity; existingProvider: IdentityKind }
  | { status: 'locked'; reason: string; restrictionId: string | null }
  | { status: 'invite_required'; pending: PendingIdentity }

const OTP_CODE = '123456'
const DEVICE_KEY = 'zenospace:device'

/** ZS-ONE-03 端末の識別情報（本番はハッシュ化して device_hashes に保存） */
export function deviceHash(): string {
  try {
    let v = localStorage.getItem(DEVICE_KEY)
    if (!v) {
      v = `dev-${uuid()}`
      localStorage.setItem(DEVICE_KEY, v)
    }
    return v
  } catch {
    return 'dev-unknown'
  }
}

function lockedResult(userId: string): SignInResult | null {
  const p = db().profiles.find((x) => x.id === userId)
  if (!p) return null
  if (p.status !== 'frozen' && p.status !== 'banned') return null
  const r = activeRestrictions(db().restrictions.filter((x) => x.userId === userId)).find((x) => x.kind === 'freeze' || x.kind === 'ban')
  return { status: 'locked', reason: r ? restrictionMessage(r) : 'このアカウントは利用できません', restrictionId: r?.id ?? null }
}

function finishSignIn(userId: string): SignInResult {
  const locked = lockedResult(userId)
  if (locked) return locked
  const p = db().profiles.find((x) => x.id === userId)!
  if (p.status === 'leaving') {
    // 退会申請から30日以内のログインは復元扱い（ZS-AUTH-09）
    p.status = 'active'
    p.deletedAt = null
  }
  p.lastLoginAt = nowIso()
  touchDevice(userId)
  setSession(userId)
  return { status: 'signed_in', userId, needsOnboarding: !p.onboarded }
}

function touchDevice(userId: string) {
  const d = db()
  const hash = deviceHash()
  const row = d.deviceHashes.find((x) => x.userId === userId && x.deviceHash === hash)
  if (row) row.lastSeenAt = nowIso()
  else d.deviceHashes.push({ userId, deviceHash: hash, firstSeenAt: nowIso(), lastSeenAt: nowIso() })
  const sameDevice = [...new Set(d.deviceHashes.filter((x) => x.deviceHash === hash).map((x) => x.userId))]
  if (sameDevice.length > 1) {
    const s = d.dupSuspicions.find((x) => x.deviceHash === hash)
    if (s) s.userIds = sameDevice
    else d.dupSuspicions.unshift({ id: uuid(), deviceHash: hash, userIds: sameDevice, status: 'open', decision: null, decidedBy: null, createdAt: nowIso() })
  }
}

function identityKindOf(p: Provider): IdentityKind {
  return p === 'email' ? 'email' : p
}

function resolve(provider: Provider, email: string, displayName?: string): SignInResult {
  const d = db()
  const normalized = normalizeEmail(email)
  const pending: PendingIdentity = { provider, email, normalized, displayName: displayName ?? email.split('@')[0] }
  if (d.bannedIdentities.includes(normalized)) {
    return { status: 'locked', reason: 'このメールアドレスでは登録できません', restrictionId: null }
  }
  const kind = identityKindOf(provider)
  const same = d.identityKeys.find((k) => k.kind === kind && k.value === normalized)
  if (same) return finishSignIn(same.userId)
  // ZS-AUTH-03 別手段で同じメールの既存アカウントがあれば連携を案内する
  const byEmail = d.identityKeys.find((k) => k.value === normalized)
  if (byEmail) return { status: 'link_suggested', pending, existingProvider: byEmail.kind }
  if (d.settings.inviteOnly) return { status: 'invite_required', pending }
  return { status: 'new_user', pending }
}

export const auth = {
  sessionUserId(): string | null {
    return sessionUserId()
  },

  /** 使えるログイン方法（モックは Google / GitHub の画面を模したデモを出す） */
  providers(): ('google' | 'github')[] {
    return ['google', 'github']
  },

  /** メールのリンクや外部ログインから戻ってきたときの続き（モックでは使わない） */
  async resumeSignIn(): Promise<SignInResult | null> {
    return null
  },

  /** 登録の途中（規約同意の前）なら、その情報を返す（モックでは登録画面の中で完結する） */
  pendingSignup(): PendingIdentity | null {
    return null
  },

  /** Google / GitHub（モックでは選んだメールアドレスで認証したことにする） */
  async signInWithProvider(provider: 'google' | 'github', email: string, displayName?: string): Promise<SignInResult> {
    const r = resolve(provider, email, displayName)
    return done(r)
  },

  /** ZS-AUTH-02 メールOTP（本番は Resend の SMTP 経由で送信） */
  async sendEmailOtp(email: string, _inviteCode?: string): Promise<{ hint: string }> {
    void _inviteCode
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError('invalid', 'メールアドレスの形式が正しくありません')
    return delay({ hint: `デモ用コード：${OTP_CODE}` })
  },

  async verifyEmailOtp(email: string, code: string): Promise<SignInResult> {
    if (code.trim() !== OTP_CODE) throw new ApiError('invalid', 'コードが正しくありません。メールに届いた6桁のコードを入力してください')
    return done(resolve('email', email))
  },

  /** 既存アカウントへのログイン手段の連携（ZS-AUTH-03） */
  async linkAndSignIn(pending: PendingIdentity): Promise<SignInResult> {
    const d = db()
    const existing = d.identityKeys.find((k) => k.value === pending.normalized)
    if (!existing) throw new ApiError('not_found', 'アカウントが見つかりません')
    const kind = identityKindOf(pending.provider)
    if (!d.identityKeys.some((k) => k.userId === existing.userId && k.kind === kind))
      d.identityKeys.push({ userId: existing.userId, kind, value: pending.normalized })
    return done(finishSignIn(existing.userId))
  },

  /** 新規登録：規約同意（ZS-AUTH-06）、年齢確認（ZS-AUTH-07）、招待コード（ZS-ONE-05） */
  async completeSignUp(input: { pending: PendingIdentity; birthYm: string; agreed: boolean; inviteCode?: string }): Promise<SignInResult> {
    const d = db()
    if (!input.agreed) throw new ApiError('invalid', '利用規約とプライバシーポリシーへの同意が必要です')
    if (!/^\d{4}-\d{2}$/.test(input.birthYm)) throw new ApiError('invalid', '生年月を入力してください')
    const [y, m] = input.birthYm.split('-').map(Number)
    const now = new Date()
    const age = now.getFullYear() - y - (now.getMonth() + 1 < m ? 1 : 0)
    // Q-02 対象年齢は仮置きで18歳以上
    if (age < 18) throw new ApiError('invalid', 'zenospace は18歳以上の方を対象としています')
    if (d.identityKeys.some((k) => k.value === input.pending.normalized)) throw new ApiError('conflict', 'このメールアドレスのアカウントはすでにあります')
    if (d.settings.inviteOnly) {
      const code = d.inviteCodes.find((c) => c.code === input.inviteCode?.trim())
      if (!code || code.usedBy || (code.expiresAt && new Date(code.expiresAt) < now)) throw new ApiError('invalid', '招待コードが正しくないか、使用済みです')
    }
    const id = uuid()
    let handle = input.pending.normalized
      .split('@')[0]
      .replace(/[^a-zA-Z0-9_]/g, '')
      .slice(0, 16)
    if (handle.length < 4) handle = `user${handle}`
    while (d.profiles.some((p) => p.handle.toLowerCase() === handle.toLowerCase())) handle = `${handle.slice(0, 14)}${Math.floor(Math.random() * 90 + 10)}`
    const ts = nowIso()
    const profile: Profile = {
      id,
      handle,
      displayName: input.pending.displayName.slice(0, 20),
      avatarUrl: null,
      avatarColor: colorFor(handle),
      coverUrl: null,
      bio: '',
      skills: [],
      links: [],
      prefecture: null,
      commissionStatus: 'consult',
      dmPolicy: 'everyone',
      profileVisibility: 'public',
      interests: [],
      status: 'active',
      isOfficial: false,
      birthYm: input.birthYm,
      handleChangedAt: null,
      onboarded: false,
      createdAt: ts,
      lastLoginAt: ts,
      deletedAt: null,
    }
    d.profiles.push(profile)
    const kind = identityKindOf(input.pending.provider)
    d.identityKeys.push({ userId: id, kind, value: input.pending.normalized })
    if (kind !== 'email') d.identityKeys.push({ userId: id, kind: 'email', value: input.pending.normalized })
    d.consents.push(
      { userId: id, doc: 'terms', version: d.settings.termsVersion, agreedAt: ts },
      { userId: id, doc: 'privacy', version: d.settings.privacyVersion, agreedAt: ts },
    )
    d.userSettings.push(defaultSettings(id))
    if (d.settings.inviteOnly && input.inviteCode) {
      const code = d.inviteCodes.find((c) => c.code === input.inviteCode!.trim())!
      code.usedBy = id
      code.usedAt = ts
    }
    // ZS-OFC-01 公式アカウントをトークリストへ自動追加
    const roomId = uuid()
    d.rooms.push({
      id: roomId,
      kind: 'official',
      name: 'zenospace 公式',
      iconUrl: null,
      iconColor: '#1F4D3B',
      ownerId: OFFICIAL_USER_ID,
      workId: null,
      lastMessageAt: ts,
      lastMessagePreview: 'zenospace へようこそ！',
      memberCount: 2,
      createdAt: ts,
    })
    d.roomMembers.push(
      {
        roomId,
        userId: id,
        role: 'member',
        state: 'active',
        lastReadAt: new Date(0).toISOString(),
        notifyLevel: 'all',
        pinnedAt: null,
        hiddenAt: null,
        joinedAt: ts,
      },
      { roomId, userId: OFFICIAL_USER_ID, role: 'owner', state: 'active', lastReadAt: ts, notifyLevel: 'all', pinnedAt: null, hiddenAt: null, joinedAt: ts },
    )
    // 歓迎メッセージは「登録時点で全員宛て」の配信として既存の歓迎配信を見せる
    const welcome = d.broadcasts.find((b) => b.title === 'ようこそ')
    if (welcome) d.broadcastRecipients.push({ broadcastId: welcome.id, userId: id })
    return done(finishSignIn(id))
  },

  /** 退会済み・凍結時の異議申し立て（未ログインでも送れる） */
  async submitLockedAppeal(restrictionId: string, body: string): Promise<void> {
    const d = db()
    const r = d.restrictions.find((x) => x.id === restrictionId)
    if (!r) throw new ApiError('not_found', '対象の措置が見つかりません')
    d.appeals.unshift({ id: uuid(), restrictionId, userId: r.userId, body, status: 'open', decidedBy: null, result: null, createdAt: nowIso() })
    return done(undefined)
  },

  async signOut(): Promise<void> {
    setSession(null)
    return done(undefined)
  },

  /** ZS-AUTH-04 ユーザーIDの変更（30日に1回） */
  async changeHandle(handle: string): Promise<void> {
    const me = currentUser()
    if (!me) throw new ApiError('unauthenticated', 'ログインしてください')
    if (!HANDLE_PATTERN.test(handle)) throw new ApiError('invalid', 'ユーザーIDは英数字と _ の4〜20文字で入力してください')
    if (me.handleChangedAt && Date.now() - new Date(me.handleChangedAt).getTime() < 30 * 86400_000)
      throw new ApiError('invalid', 'ユーザーIDの変更は30日に1回までです')
    if (db().profiles.some((p) => p.id !== me.id && p.handle.toLowerCase() === handle.toLowerCase()))
      throw new ApiError('conflict', 'このユーザーIDはすでに使われています')
    me.handle = handle
    me.handleChangedAt = nowIso()
    return done(undefined)
  },

  linkedIdentities(): IdentityKind[] {
    const me = currentUser()
    if (!me) return []
    return [
      ...new Set(
        db()
          .identityKeys.filter((k) => k.userId === me.id)
          .map((k) => k.kind),
      ),
    ]
  },

  async linkProvider(provider: 'google' | 'github', email: string): Promise<void> {
    const me = currentUser()
    if (!me) throw new ApiError('unauthenticated', 'ログインしてください')
    const normalized = normalizeEmail(email)
    const other = db().identityKeys.find((k) => k.value === normalized && k.userId !== me.id)
    if (other) throw new ApiError('conflict', 'このアカウントは別のユーザーに連携されています')
    db().identityKeys.push({ userId: me.id, kind: provider, value: normalized })
    return done(undefined)
  },

  /** ZS-AUTH-09 退会申請（30日は復元可能） */
  async requestDeletion(): Promise<void> {
    const me = currentUser()
    if (!me) throw new ApiError('unauthenticated', 'ログインしてください')
    me.status = 'leaving'
    me.deletedAt = nowIso()
    setSession(null)
    return done(undefined)
  },

  /** 規約改定時の再同意（ZS-AUTH-06） */
  needsReconsent(): boolean {
    const me = currentUser()
    if (!me) return false
    const d = db()
    const has = (doc: 'terms' | 'privacy', v: string) => d.consents.some((c) => c.userId === me.id && c.doc === doc && c.version === v)
    return !has('terms', d.settings.termsVersion) || !has('privacy', d.settings.privacyVersion)
  },

  async agreeLatestTerms(): Promise<void> {
    const me = currentUser()
    if (!me) throw new ApiError('unauthenticated', 'ログインしてください')
    const d = db()
    d.consents.push(
      { userId: me.id, doc: 'terms', version: d.settings.termsVersion, agreedAt: nowIso() },
      { userId: me.id, doc: 'privacy', version: d.settings.privacyVersion, agreedAt: nowIso() },
    )
    return done(undefined)
  },

  // ---- 運営コンソールのログイン（A-01） ----
  adminRole() {
    const me = currentUser()
    return me ? adminRoleOf(me.id) : null
  },

  /** 運営ログインの準備（モックはオーナーと認証アプリが登録済みの扱い） */
  async adminSetup(): Promise<{ bootstrapNeeded: boolean; totp: { qr: string; secret: string } | null }> {
    return delay({ bootstrapNeeded: false, totp: null })
  },

  /** 初期設定：最初の運営オーナーになる（モックではデモのオーナーがいるため何もしない） */
  async claimOwner(): Promise<boolean> {
    return delay(false)
  },

  /** TOTP の検証。本番は Supabase Auth の MFA（factor の challenge / verify）を使う */
  async verifyAdminTotp(code: string): Promise<void> {
    const me = currentUser()
    if (!me) throw new ApiError('unauthenticated', 'ログインしてください')
    const role = adminRoleOf(me.id)
    if (!role) throw new ApiError('forbidden', '運営メンバーではありません')
    if (!/^\d{6}$/.test(code) || code !== OTP_CODE) throw new ApiError('invalid', '確認コードが正しくありません')
    const m = db().adminMembers.find((x) => x.userId === me.id)!
    m.totpEnrolled = true
    setAdminSession(me.id)
    audit(me.id, 'admin.login', 'admin_member', me.id, null, { role })
    return done(undefined)
  },

  adminSignOut() {
    setAdminSession(null)
  },

  /** 招待コードの発行（ZS-ONE-05） */
  async issueInviteCode(): Promise<string> {
    const me = currentUser()
    if (!me) throw new ApiError('unauthenticated', 'ログインしてください')
    const code = Math.random().toString(36).slice(2, 10).toUpperCase()
    db().inviteCodes.push({ code, issuedBy: me.id, usedBy: null, usedAt: null, expiresAt: new Date(Date.now() + 14 * 86400_000).toISOString() })
    notify(me.id, 'important', { target: '/settings/account', text: `招待コード ${code} を発行しました` })
    return done(code)
  },
}
