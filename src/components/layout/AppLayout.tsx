import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Home, Search, Plus, MessageCircle, User, Bell, Newspaper, Settings, Shield, X } from 'lucide-react'
import { api } from '@/lib/api'
import { useSync } from '@/hooks/useLive'
import { useOnline } from '@/hooks/misc'
import { useMe, useOpenLogin } from '@/app/session'
import { Logo } from '@/components/ui/illustrations'
import { Avatar, Button, IconButton, Sheet } from '@/components/ui/primitives'
import { OfflineBar } from '@/components/ui/states'
import { WORK_TYPES } from '@/lib/constants'
import { WorkTypeIcon } from '@/components/work/WorkCard'
import { RestrictionBanner } from '@/components/RestrictionBanner'
import { cn } from '@/lib/cn'
import type { WorkType } from '@/lib/types'

function useCounts() {
  const me = useMe()
  const unread = useSync(() => (me ? api.chat.unreadTotal() + api.chat.requestCount() : 0))
  const notif = useSync(() => (me ? api.notifications.unreadCount() : 0))
  // ZS-NOTIF-07 ホーム画面アイコンの未読数（Badging API）
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    if (!nav.setAppBadge) return
    if (unread > 0) void nav.setAppBadge(unread).catch(() => {})
    else void nav.clearAppBadge?.().catch(() => {})
  }, [unread])
  return { unread, notif }
}

/** 投稿ボタン：押すと作品の種類を選ぶシートが開く（13.1） */
export function PostTypeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <Sheet open={open} onClose={onClose} title="作品の種類を選ぶ" size="md">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {WORK_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => {
              onClose()
              navigate(`/post?type=${t.value}`)
            }}
            className="card flex min-h-28 flex-col items-start gap-2 p-4 text-left transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98]"
          >
            <span className="bg-signature flex size-10 items-center justify-center rounded-full text-white">
              <WorkTypeIcon type={t.value as WorkType} className="size-5" />
            </span>
            <span className="text-body-m font-bold">{t.label}</span>
            <span className="text-caption text-fg2">{t.desc}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}

function useHideTabs() {
  const { pathname } = useLocation()
  return /^\/talk\/[^/]+$/.test(pathname) && pathname !== '/talk/requests' && pathname !== '/talk/new-group'
}

/** トーク画面は画面の高さいっぱいに広げ、制限バナーやオフライン帯の分だけ縮める */
function useFullHeight() {
  const { pathname } = useLocation()
  return /^\/talk(\/[^/]+)?$/.test(pathname) && pathname !== '/talk/requests' && pathname !== '/talk/new-group'
}

export function AppLayout() {
  const me = useMe()
  const online = useOnline()
  const [postOpen, setPostOpen] = useState(false)
  const { unread, notif } = useCounts()
  const hideTabs = useHideTabs()
  const fullHeight = useFullHeight()
  const openLogin = useOpenLogin()
  const navigate = useNavigate()
  const adminRole = useSync(() => api.auth.adminRole())
  const location = useLocation()

  const onPost = () => {
    if (!me) openLogin({ type: 'nav', to: '/post' })
    else setPostOpen(true)
  }

  // Ctrl+K / ⌘K で検索（15.2）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        navigate('/search?focus=1')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  const nav = [
    { to: '/home', label: 'ホーム', icon: Home },
    { to: '/search', label: 'さがす', icon: Search },
    { to: '/talk', label: 'トーク', icon: MessageCircle, badge: unread },
    { to: '/notifications', label: '通知', icon: Bell, badge: notif },
    { to: '/news', label: 'AIニュース', icon: Newspaper },
    { to: '/me', label: 'マイページ', icon: User },
    { to: '/settings', label: '設定', icon: Settings },
  ]

  return (
    <div className="min-h-dvh lg:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-brand focus:px-3 focus:py-2 focus:text-white"
      >
        本文へ移動
      </a>
      {/* PC：左サイドバー（13.1） */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-subtle px-3 py-5 lg:flex">
        <Link to="/home" className="mb-6 px-3">
          <Logo />
        </Link>
        <nav className="flex flex-1 flex-col gap-1" aria-label="メイン">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 items-center gap-3 rounded-[12px] px-3 text-body-m transition-colors',
                  isActive ? 'bg-elevated font-bold text-brand-text' : 'text-fg2 hover:bg-surface hover:text-fg',
                )
              }
            >
              <n.icon className="size-5" strokeWidth={1.75} />
              <span className="flex-1">{n.label}</span>
              {!!n.badge && <span className="rounded-full bg-danger px-1.5 text-[11px] font-bold text-white tabular">{n.badge > 99 ? '99+' : n.badge}</span>}
            </NavLink>
          ))}
          {adminRole && (
            <NavLink to="/admin" className="flex min-h-11 items-center gap-3 rounded-[12px] px-3 text-body-m text-fg2 hover:bg-surface hover:text-fg">
              <Shield className="size-5" strokeWidth={1.75} /> 運営コンソール
            </NavLink>
          )}
          <Button variant="signature" size="lg" className="mt-4" icon={<Plus className="size-5" />} onClick={onPost}>
            作品を投稿
          </Button>
        </nav>
        {me ? (
          <Link to="/me" className="flex items-center gap-3 rounded-[12px] p-2 hover:bg-surface">
            <Avatar name={me.displayName} color={me.avatarColor} url={me.avatarUrl} size={36} />
            <span className="min-w-0">
              <span className="block truncate text-body-m font-bold">{me.displayName}</span>
              <span className="block truncate text-caption text-fg2">@{me.handle}</span>
            </span>
          </Link>
        ) : (
          <Button onClick={() => openLogin()} block>
            ログイン
          </Button>
        )}
      </aside>

      <div className={cn('min-w-0 flex-1', fullHeight && 'flex h-dvh flex-col')}>
        {!online && (
          <div className="sticky top-0 z-40">
            <OfflineBar />
          </div>
        )}
        <RestrictionBanner />
        <main
          id="main"
          className={cn(
            'mx-auto w-full max-w-[1440px]',
            fullHeight && 'min-h-0 flex-1 overflow-y-auto',
            !hideTabs && (fullHeight ? 'pb-[calc(64px+env(safe-area-inset-bottom))] lg:pb-0' : 'pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-8'),
          )}
        >
          <Outlet />
        </main>
      </div>

      {/* スマホ・タブレット：下部5タブ（中央は投稿ボタン） */}
      {!hideTabs && (
        <nav className="glass fixed inset-x-0 bottom-0 z-30 border-t border-subtle pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="メイン">
          <div className="mx-auto grid h-16 max-w-xl grid-cols-5 items-center">
            <Tab to="/home" icon={Home} label="ホーム" />
            <Tab to="/search" icon={Search} label="さがす" />
            <div className="flex justify-center">
              <button
                onClick={onPost}
                aria-label="作品を投稿"
                className="bg-signature flex size-12 items-center justify-center rounded-full text-white shadow-lg shadow-brand/30 transition-transform duration-100 active:scale-90"
              >
                <Plus className="size-6" strokeWidth={2} />
              </button>
            </div>
            <Tab to="/talk" icon={MessageCircle} label="トーク" badge={unread} />
            <Tab to="/me" icon={User} label="マイページ" />
          </div>
        </nav>
      )}
      <PostTypeSheet open={postOpen} onClose={() => setPostOpen(false)} />
    </div>
  )
}

function Tab({ to, icon: Icon, label, badge }: { to: string; icon: typeof Home; label: string; badge?: number }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn('relative flex h-full flex-col items-center justify-center gap-0.5 text-[10px] font-bold', isActive ? 'text-brand-text' : 'text-fg2')
      }
    >
      {({ isActive }) => (
        <>
          <span key={String(isActive)} className={cn('relative', isActive && 'anim-tab')}>
            <Icon className={cn('size-6', isActive && 'fill-current/20')} strokeWidth={isActive ? 2.2 : 1.75} />
            {!!badge && (
              <span className="absolute -right-2.5 -top-1.5 min-w-[18px] rounded-full bg-danger px-1 text-center text-[10px] leading-[18px] text-white tabular">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </span>
          {label}
        </>
      )}
    </NavLink>
  )
}

/** 上部ヘッダー：画面タイトル、検索、通知ベル（ガラス表現） */
export function PageHeader({
  title,
  back,
  actions,
  children,
  className,
  hideOnDesktop,
}: {
  title?: ReactNode
  back?: boolean | string
  actions?: ReactNode
  children?: ReactNode
  className?: string
  hideOnDesktop?: boolean
}) {
  const navigate = useNavigate()
  const me = useMe()
  const notif = useSync(() => (me ? api.notifications.unreadCount() : 0))
  return (
    <header className={cn('glass sticky top-0 z-20 border-b border-subtle', hideOnDesktop && 'lg:hidden', className)}>
      <div className="flex h-14 items-center gap-1 px-2 sm:px-4">
        {back && (
          <IconButton label="戻る" onClick={() => (typeof back === 'string' ? navigate(back) : window.history.length > 1 ? navigate(-1) : navigate('/home'))}>
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </IconButton>
        )}
        <div className={cn('min-w-0 flex-1 truncate text-title-m', !back && 'pl-2')}>{title}</div>
        {actions ?? (
          <>
            <IconButton label="検索" onClick={() => navigate('/search?focus=1')} className="lg:hidden">
              <Search className="size-5" strokeWidth={1.75} />
            </IconButton>
            {me && (
              <IconButton label={`通知${notif ? `（未読${notif}件）` : ''}`} badge={!!notif} onClick={() => navigate('/notifications')} className="lg:hidden">
                <Bell className="size-5" strokeWidth={1.75} />
              </IconButton>
            )}
          </>
        )}
      </div>
      {children}
    </header>
  )
}

/** ZS-HOME-06 お知らせバナー（閉じたら再表示しない） */
export function BannerStrip() {
  const list = useSync(() => api.banners.active())
  const visible = list.filter((b) => {
    try {
      return !localStorage.getItem(`zenospace:banner:${b.id}`)
    } catch {
      return true
    }
  })
  if (!visible.length) return null
  return (
    <div className="space-y-2">
      {visible.map((b) => (
        <div key={b.id} className="card flex items-start gap-3 border-aurora/30 p-3">
          <span className="mt-1 size-2 shrink-0 rounded-full bg-aurora" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-body-m font-bold">{b.title}</p>
            <p className="text-caption text-fg2">{b.body}</p>
            {b.link && (
              <a href={b.link} className="text-caption text-brand-text underline">
                詳しく見る
              </a>
            )}
          </div>
          <IconButton label="お知らせを閉じる" className="-m-2" onClick={() => api.banners.dismiss(b.id)}>
            <X className="size-4" />
          </IconButton>
        </div>
      ))}
    </div>
  )
}
