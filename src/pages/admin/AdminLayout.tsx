import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Flag,
  LayoutGrid,
  Megaphone,
  Newspaper,
  Inbox,
  PanelTop,
  Database,
  ShieldCheck,
  ScrollText,
  Settings,
  ArrowLeft,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import { api, dataSource, errorMessage } from '@/lib/api'
import { useLive, useSync } from '@/hooks/useLive'
import { useMe } from '@/app/session'
import { can, adminSession, type Permission } from '@/lib/api/shared'
import { Ambient, Logo } from '@/components/ui/illustrations'
import { Badge, Button, IconButton, TextField } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/cn'
import type { AdminRole } from '@/lib/types'

const ROLE_LABEL: Record<AdminRole, string> = { owner: 'オーナー', admin: '管理者', moderator: 'モデレーター', publisher: '配信担当', viewer: '閲覧者' }

const NAV: { to: string; label: string; icon: typeof Users; perm: Permission }[] = [
  { to: '/admin', label: 'ダッシュボード', icon: LayoutDashboard, perm: 'dashboard' },
  { to: '/admin/users', label: 'ユーザー', icon: Users, perm: 'users' },
  { to: '/admin/reports', label: '通報キュー', icon: Flag, perm: 'reports' },
  { to: '/admin/works', label: '作品管理', icon: LayoutGrid, perm: 'users' },
  { to: '/admin/broadcasts', label: '一斉配信', icon: Megaphone, perm: 'broadcastCreate' },
  { to: '/admin/news', label: 'AIニュース', icon: Newspaper, perm: 'news' },
  { to: '/admin/support', label: 'サポート受信箱', icon: Inbox, perm: 'support' },
  { to: '/admin/banners', label: 'お知らせ・バナー', icon: PanelTop, perm: 'broadcastCreate' },
  { to: '/admin/masters', label: 'マスタ管理', icon: Database, perm: 'masters' },
  { to: '/admin/members', label: '運営メンバー', icon: ShieldCheck, perm: 'dashboard' },
  { to: '/admin/audit', label: '監査ログ', icon: ScrollText, perm: 'audit' },
  { to: '/admin/settings', label: 'システム設定', icon: Settings, perm: 'system' },
]

export function useAdminRole(): AdminRole | null {
  return useSync(() => api.auth.adminRole())
}

/** 運営コンソールの外枠。TOTP 済みのセッションでなければ A-01 へ。30分操作がなければ再認証 */
export default function AdminLayout() {
  const me = useMe()
  const role = useAdminRole()
  const location = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => setOpen(false), [location.pathname])
  if (!me) return <Navigate to="/login" replace />
  if (!role) return <Navigate to="/home" replace />
  const s = adminSession()
  if (!s || s.userId !== me.id || Date.now() - s.at > 30 * 60_000) return <Navigate to={`/admin/login?next=${encodeURIComponent(location.pathname)}`} replace />
  const items = NAV.filter((n) => can(role, n.perm))
  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="運営メニュー">
      {items.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === '/admin'}
          className={({ isActive }) =>
            cn(
              'flex min-h-10 items-center gap-3 rounded-[10px] px-3 text-body-m',
              isActive ? 'bg-elevated font-bold text-brand-text' : 'text-fg2 hover:bg-surface hover:text-fg',
            )
          }
        >
          <n.icon className="size-4.5" strokeWidth={1.75} />
          {n.label}
        </NavLink>
      ))}
    </nav>
  )
  return (
    <div className="min-h-dvh lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-4 border-r border-subtle p-3 lg:flex">
        <div className="px-2 pt-2">
          <Logo />
          <p className="mt-1 text-caption text-fg2">運営コンソール</p>
        </div>
        {nav}
        <Footer role={role} onLogout={() => (api.auth.adminSignOut(), navigate('/home'))} />
      </aside>
      <header className="glass sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-subtle px-2 lg:hidden">
        <IconButton label="メニュー" onClick={() => setOpen(true)}>
          <Menu className="size-5" />
        </IconButton>
        <span className="flex-1 text-body-m font-bold">運営コンソール</span>
        <Badge tone="brand">{ROLE_LABEL[role]}</Badge>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="anim-fade absolute inset-y-0 left-0 flex w-72 flex-col gap-4 bg-elevated p-3">
            <div className="flex items-center justify-between">
              <Logo />
              <IconButton label="閉じる" onClick={() => setOpen(false)}>
                <X className="size-5" />
              </IconButton>
            </div>
            {nav}
            <Footer role={role} onLogout={() => (api.auth.adminSignOut(), navigate('/home'))} />
          </aside>
        </div>
      )}
      <main className="min-w-0 flex-1 p-4 lg:p-8">
        <Outlet />
      </main>
    </div>
  )
}

function Footer({ role, onLogout }: { role: AdminRole; onLogout: () => void }) {
  const me = useMe()!
  return (
    <div className="space-y-1 border-t border-subtle pt-3">
      <p className="px-2 text-caption text-fg2">
        {me.displayName}・<span className="text-brand-text">{ROLE_LABEL[role]}</span>
      </p>
      <Link to="/home" className="flex min-h-10 items-center gap-3 rounded-[10px] px-3 text-body-m text-fg2 hover:bg-surface">
        <ArrowLeft className="size-4" /> アプリに戻る
      </Link>
      <button onClick={onLogout} className="flex min-h-10 w-full items-center gap-3 rounded-[10px] px-3 text-left text-body-m text-fg2 hover:bg-surface">
        <LogOut className="size-4" /> コンソールからログアウト
      </button>
    </div>
  )
}

/** A-01 運営ログイン：ログイン＋二要素認証（TOTP）。初回は最初のオーナーを決め、認証アプリを登録する */
export function AdminLogin() {
  const me = useMe()
  const role = useAdminRole()
  const navigate = useNavigate()
  const toast = useToast()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const setup = useLive(() => (me ? api.auth.adminSetup() : Promise.resolve(null)), [me?.id, role])
  const next = new URLSearchParams(location.search).get('next') ?? '/admin'
  if (!me) return <Navigate to="/login" replace />
  if (!role)
    return (
      <div className="relative isolate flex min-h-dvh items-center justify-center p-6 text-center">
        <Ambient />
        {setup.data?.bootstrapNeeded ? (
          <div className="card relative w-full max-w-sm space-y-4 p-6 text-left">
            <div className="text-center">
              <Logo className="justify-center" />
              <p className="mt-2 text-body-m text-fg2">運営コンソールの初期設定</p>
            </div>
            <p className="text-body-m">
              運営オーナーがまだいません。いまログインしている{' '}
              <strong>
                {me.displayName}（@{me.handle}）
              </strong>{' '}
              を最初のオーナーにしますか？
            </p>
            <p className="text-caption text-fg2">オーナーは1人目だけこの画面で決められます。2人目以降は運営コンソールの「運営メンバー」から追加します。</p>
            <Button
              block
              size="lg"
              loading={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await api.auth.claimOwner()
                  setup.reload()
                } catch (err) {
                  toast({ text: errorMessage(err), tone: 'error' })
                } finally {
                  setBusy(false)
                }
              }}
            >
              オーナーになる
            </Button>
          </div>
        ) : (
          <div className="relative space-y-3">
            <p className="text-title-m">{setup.loading ? '確認しています…' : '運営メンバーではありません'}</p>
            <Link to="/home" className="text-brand-text underline">
              アプリに戻る
            </Link>
          </div>
        )}
      </div>
    )
  const totp = setup.data?.totp
  return (
    <div className="relative isolate flex min-h-dvh items-center justify-center px-4 py-10">
      <Ambient />
      <form
        className="card relative w-full max-w-sm space-y-4 p-6"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            await api.auth.verifyAdminTotp(code)
            navigate(next, { replace: true })
          } catch (err) {
            toast({ text: errorMessage(err), tone: 'error' })
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="text-center">
          <Logo className="justify-center" />
          <p className="mt-2 text-body-m text-fg2">運営コンソール</p>
        </div>
        {totp ? (
          <div className="space-y-3">
            <p className="text-body-m">
              はじめに、認証アプリ（Google Authenticator、1Password など）でこの QR コードを読み取ってください。読み取れない場合は下のキーを入力します。
            </p>
            <img src={totp.qr} alt="認証アプリに登録する QR コード" className="mx-auto size-44 rounded-[10px] bg-white p-2" />
            <p className="break-all rounded-[10px] bg-surface p-2 text-center font-mono text-caption">{totp.secret}</p>
          </div>
        ) : (
          <p className="text-body-m">
            {me.displayName}（{ROLE_LABEL[role]}）としてログインします。認証アプリに表示されている6桁の確認コードを入力してください。
          </p>
        )}
        <TextField
          label="確認コード（TOTP）"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          autoFocus
          hint={dataSource === 'mock' ? 'モック動作中のコード：123456' : undefined}
        />
        <Button type="submit" block size="lg" loading={busy} disabled={setup.loading}>
          ログイン
        </Button>
      </form>
    </div>
  )
}

export { ROLE_LABEL }
