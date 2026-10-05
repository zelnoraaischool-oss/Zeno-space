import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, ChevronLeft, ShieldAlert } from 'lucide-react'
import { api, dataSource, errorMessage, type PendingIdentity, type SignInResult } from '@/lib/api'
import { DEMO_ACCOUNTS } from '@/lib/api/shared'
import { Button, TextField, TextArea } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'

type Step =
  | { s: 'choose' }
  | { s: 'provider'; provider: 'google' | 'github' }
  | { s: 'email' }
  | { s: 'otp'; email: string; hint: string }
  | { s: 'signup'; pending: PendingIdentity; invite: boolean }
  | { s: 'link'; pending: PendingIdentity; existing: string }
  | { s: 'locked'; reason: string; restrictionId: string | null }

const PROVIDER_LABEL = { google: 'Google', github: 'GitHub', email: 'メール' } as const

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12S6.7 21.6 12 21.6c6.9 0 9.2-4.9 9.2-7.4 0-.5-.1-.9-.1-1.3H12z"
      />
    </svg>
  )
}
function GithubMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .5z" />
    </svg>
  )
}

/** U-02 ログイン・新規登録。Google を標準、GitHub とメールOTPは任意（ZS-AUTH-01/02） */
export function LoginPanel({ onDone, compact }: { onDone: (needsOnboarding: boolean) => void; compact?: boolean }) {
  // メールを確認したまま登録を終えていない場合は、生年月と規約同意の入力から再開する
  const [step, setStep] = useState<Step>(() => {
    const p = api.auth.pendingSignup()
    return p ? { s: 'signup', pending: p, invite: false } : { s: 'choose' }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()

  const handle = (r: SignInResult) => {
    setError(null)
    switch (r.status) {
      case 'signed_in':
        onDone(r.needsOnboarding)
        break
      case 'new_user':
        setStep({ s: 'signup', pending: r.pending, invite: false })
        break
      case 'invite_required':
        setStep({ s: 'signup', pending: r.pending, invite: true })
        break
      case 'link_suggested':
        setStep({ s: 'link', pending: r.pending, existing: PROVIDER_LABEL[r.existingProvider] })
        break
      case 'locked':
        setStep({ s: 'locked', reason: r.reason, restrictionId: r.restrictionId })
        break
    }
  }

  const run = async (fn: () => Promise<SignInResult>) => {
    setBusy(true)
    setError(null)
    try {
      handle(await fn())
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  // メールのリンクや Google から戻ってきたとき：凍結・登録途中などの確認を続ける
  useEffect(() => {
    if (dataSource !== 'supabase') return
    const q = new URLSearchParams(location.search)
    if (!q.has('code') && !q.has('oauth')) return
    void api.auth
      .resumeSignIn()
      .then((r) => r && handle(r))
      .catch((e) => setError(errorMessage(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const providers = api.auth.providers()
  const real = dataSource === 'supabase'

  const back = (
    <button className="mb-2 inline-flex min-h-11 items-center gap-1 text-label text-fg2" onClick={() => setStep({ s: 'choose' })}>
      <ChevronLeft className="size-4" /> 戻る
    </button>
  )

  if (step.s === 'choose')
    return (
      <div className="space-y-3">
        {providers.includes('google') && (
          <Button
            variant="secondary"
            size="lg"
            block
            icon={<GoogleMark />}
            loading={busy}
            onClick={() => (real ? run(() => api.auth.signInWithProvider('google', '')) : setStep({ s: 'provider', provider: 'google' }))}
            className="!bg-white !text-[#1f1f1f]"
          >
            Googleではじめる
          </Button>
        )}
        {providers.includes('github') && (
          <Button
            variant="secondary"
            size="lg"
            block
            icon={<GithubMark />}
            loading={busy}
            onClick={() => (real ? run(() => api.auth.signInWithProvider('github', '')) : setStep({ s: 'provider', provider: 'github' }))}
          >
            GitHubではじめる
          </Button>
        )}
        <Button
          variant={providers.length ? 'ghost' : 'signature'}
          size="lg"
          block
          icon={<Mail className="size-5" strokeWidth={1.75} />}
          onClick={() => setStep({ s: 'email' })}
        >
          {providers.length ? 'メールでログイン' : 'メールではじめる'}
        </Button>
        {error && (
          <p className="text-caption text-danger" role="alert">
            {error}
          </p>
        )}
        {!compact && (
          <p className="pt-2 text-center text-caption text-fg2">
            続けると
            <Link className="text-brand-text underline" to="/legal/terms">
              利用規約
            </Link>
            と
            <Link className="text-brand-text underline" to="/legal/privacy">
              プライバシーポリシー
            </Link>
            を確認したことになります。パスワードは使いません。
          </p>
        )}
        {/* 本番は Cloudflare Turnstile をここに表示する（18.3 ボット対策） */}
      </div>
    )

  if (step.s === 'provider')
    return (
      <ProviderPicker
        provider={step.provider}
        busy={busy}
        error={error}
        back={back}
        onPick={(email, name) => run(() => api.auth.signInWithProvider(step.provider, email, name))}
      />
    )

  if (step.s === 'email')
    return (
      <EmailStep
        back={back}
        busy={busy}
        error={error}
        invite={real && api.app.settings().inviteOnly}
        onSend={async (email, invite) => {
          setBusy(true)
          setError(null)
          try {
            const { hint } = await api.auth.sendEmailOtp(email, invite)
            setStep({ s: 'otp', email, hint })
          } catch (e) {
            setError(errorMessage(e))
          } finally {
            setBusy(false)
          }
        }}
      />
    )

  if (step.s === 'otp')
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          const code = new FormData(e.currentTarget).get('code') as string
          void run(() => api.auth.verifyEmailOtp(step.email, code))
        }}
      >
        {back}
        <p className="text-body-m text-fg2">
          {step.email} に届いた確認コードを入力してください。{real && 'メールの「ログインする」ボタンからもログインできます。'}
        </p>
        {/* 3.3.8 貼り付けと自動入力に対応する */}
        <TextField
          name="code"
          label="確認コード"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6,8}"
          maxLength={8}
          required
          error={error}
          hint={step.hint}
          autoFocus
        />
        <Button type="submit" block size="lg" loading={busy}>
          ログインする
        </Button>
      </form>
    )

  if (step.s === 'link')
    return (
      <div className="space-y-4">
        {back}
        <p className="text-body-m">
          このメールアドレスのアカウントは、すでに<strong>{step.existing}</strong>で登録されています。zenospace
          は1人1アカウントのため、新しいアカウントは作れません。
        </p>
        <p className="text-body-m text-fg2">{PROVIDER_LABEL[step.pending.provider]}でもログインできるよう、既存のアカウントに連携しますか？</p>
        {error && <p className="text-caption text-danger">{error}</p>}
        <Button block size="lg" loading={busy} onClick={() => run(() => api.auth.linkAndSignIn(step.pending))}>
          既存のアカウントに連携してログイン
        </Button>
      </div>
    )

  if (step.s === 'locked')
    return (
      <LockedStep
        reason={step.reason}
        restrictionId={step.restrictionId}
        back={back}
        onSent={() => toast({ text: '異議申し立てを受け付けました。結果はメールでお知らせします', tone: 'success' })}
      />
    )

  return <SignupStep pending={step.pending} invite={step.invite} back={back} onDone={handle} />
}

function ProviderPicker({
  provider,
  busy,
  error,
  back,
  onPick,
}: {
  provider: 'google' | 'github'
  busy: boolean
  error: string | null
  back: React.ReactNode
  onPick: (email: string, name?: string) => void
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  return (
    <div className="space-y-4">
      {back}
      <div className="rounded-[12px] border border-dashed border-aurora/50 bg-aurora/5 p-3 text-caption text-fg2">
        モック動作中：{provider === 'google' ? 'Google' : 'GitHub'} の認証画面の代わりに、使うアカウントを選びます（Supabase Auth
        接続後は実際の認証画面に移動します）。
      </div>
      <div className="space-y-2">
        <p className="text-label">デモアカウント</p>
        {DEMO_ACCOUNTS.map((a) => (
          <button
            key={a.email}
            disabled={busy}
            onClick={() => onPick(a.email)}
            className="card flex min-h-12 w-full items-center justify-between px-3 text-left hover:bg-elevated"
          >
            <span className="text-body-m">{a.label}</span>
            <span className="text-caption text-fg2">{a.email}</span>
          </button>
        ))}
      </div>
      <form
        className="space-y-3 border-t border-subtle pt-4"
        onSubmit={(e) => {
          e.preventDefault()
          onPick(email, name || undefined)
        }}
      >
        <p className="text-label">別のアカウントで新規登録</p>
        <TextField
          type="email"
          label="メールアドレス"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          placeholder="you@gmail.com"
        />
        <TextField label="表示名" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="あなたの名前" />
        {error && <p className="text-caption text-danger">{error}</p>}
        <Button type="submit" block loading={busy}>
          続ける
        </Button>
      </form>
    </div>
  )
}

function EmailStep({
  back,
  busy,
  error,
  invite,
  onSend,
}: {
  back: React.ReactNode
  busy: boolean
  error: string | null
  invite?: boolean
  onSend: (email: string, invite?: string) => void
}) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSend(email, code || undefined)
      }}
    >
      {back}
      <p className="text-body-m text-fg2">メールに届く確認コードでログインします。はじめての方は、そのまま新規登録になります。</p>
      <TextField
        type="email"
        label="メールアドレス"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
        error={error}
        autoFocus
      />
      {invite && (
        <TextField
          label="招待コード（はじめての方）"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          hint="現在は招待制です。招待した人から受け取ったコードを入力してください"
        />
      )}
      <Button type="submit" block size="lg" loading={busy}>
        コードを送る
      </Button>
    </form>
  )
}

function SignupStep({
  pending,
  invite,
  back,
  onDone,
}: {
  pending: PendingIdentity
  invite: boolean
  back: React.ReactNode
  onDone: (r: SignInResult) => void
}) {
  const [birth, setBirth] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
          onDone(await api.auth.completeSignUp({ pending, birthYm: birth, agreed, inviteCode: code }))
        } catch (err) {
          setError(errorMessage(err))
        } finally {
          setBusy(false)
        }
      }}
    >
      {back}
      <div>
        <p className="text-title-m">はじめまして</p>
        <p className="text-body-m text-fg2">{pending.email} で新しいアカウントを作ります。</p>
      </div>
      {invite && (
        <TextField
          label="招待コード"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          hint="現在は招待制です。招待した人から受け取ったコードを入力してください"
        />
      )}
      {/* ZS-AUTH-07 年齢確認（対象年齢は Q-02：仮置き18歳以上） */}
      <TextField type="month" label="生年月" value={birth} onChange={(e) => setBirth(e.target.value)} required hint="年齢の確認にだけ使い、公開しません" />
      <label className="flex min-h-11 items-start gap-3 text-body-m">
        <input type="checkbox" className="mt-1 size-5 accent-[var(--brand-primary)]" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} required />
        <span>
          <Link to="/legal/terms" target="_blank" className="text-brand-text underline">
            利用規約
          </Link>
          と
          <Link to="/legal/privacy" target="_blank" className="text-brand-text underline">
            プライバシーポリシー
          </Link>
          に同意します。zenospace は1人1アカウントでご利用ください。
        </span>
      </label>
      {error && (
        <p className="text-caption text-danger" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="signature" size="lg" block loading={busy} disabled={!agreed}>
        アカウントを作成
      </Button>
    </form>
  )
}

function LockedStep({ reason, restrictionId, back, onSent }: { reason: string; restrictionId: string | null; back: React.ReactNode; onSent: () => void }) {
  const [body, setBody] = useState('')
  const [sent, setSent] = useState(false)
  return (
    <div className="space-y-4">
      {back}
      <div className="flex gap-3 rounded-[12px] border border-warning/40 bg-warning/10 p-3">
        <ShieldAlert className="size-5 shrink-0 text-warning" />
        <p className="text-body-m">{reason}</p>
      </div>
      {restrictionId && !sent && (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            await api.auth.submitLockedAppeal(restrictionId, body)
            setSent(true)
            onSent()
          }}
        >
          <TextArea label="異議申し立て" value={body} onChange={(e) => setBody(e.target.value)} required placeholder="状況を具体的に教えてください" />
          <Button type="submit" block>
            申し立てを送る
          </Button>
        </form>
      )}
      {sent && <p className="text-body-m text-fg2">申し立てを受け付けました。内容を確認し、結果をお知らせします。</p>}
    </div>
  )
}
