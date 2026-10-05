import { Navigate, useNavigate } from 'react-router-dom'
import { useMe } from '@/app/session'
import { LoginPanel } from '@/components/auth/LoginPanel'
import { Ambient, Logo } from '@/components/ui/illustrations'

/** U-02 ログイン・新規登録 */
export default function Login() {
  const me = useMe()
  const navigate = useNavigate()
  if (me) return <Navigate to={me.onboarded ? '/home' : '/onboarding'} replace />
  return (
    <div className="relative isolate flex min-h-dvh items-center justify-center px-4 py-10">
      <Ambient />
      <div className="card relative w-full max-w-sm p-8">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo />
          <span className="mt-6 h-px w-16 bg-[var(--text-secondary)] opacity-40" aria-hidden />
          <p className="mt-4 font-serif text-title-m">ログイン・新規登録</p>
          <p className="mt-1 text-caption tracking-[0.08em] text-fg2">パスワードは使いません</p>
        </div>
        <LoginPanel onDone={(needs) => navigate(needs ? '/onboarding' : '/home', { replace: true })} />
      </div>
    </div>
  )
}
