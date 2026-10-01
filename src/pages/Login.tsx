import { Navigate, useNavigate } from 'react-router-dom'
import { useMe } from '@/app/session'
import { LoginPanel } from '@/components/auth/LoginPanel'
import { Logo } from '@/components/ui/illustrations'

/** U-02 ログイン・新規登録 */
export default function Login() {
  const me = useMe()
  const navigate = useNavigate()
  if (me) return <Navigate to={me.onboarded ? '/home' : '/onboarding'} replace />
  return (
    <div className="relative flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="stars pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div className="card relative w-full max-w-sm p-6">
        <div className="mb-6 text-center">
          <Logo className="justify-center" />
          <p className="mt-3 text-body-m text-fg2">ログイン・新規登録</p>
        </div>
        <LoginPanel onDone={(needs) => navigate(needs ? '/onboarding' : '/home', { replace: true })} />
      </div>
    </div>
  )
}
