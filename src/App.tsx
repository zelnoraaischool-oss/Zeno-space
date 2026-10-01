import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router-dom'
import { api, startBackgroundJobs } from '@/lib/api'
import { useSync } from '@/hooks/useLive'
import { outbox } from '@/lib/outbox'
import { ToastProvider } from '@/components/ui/toast'
import { Spinner } from '@/components/ui/primitives'
import { MaintenanceScreen, FullError } from '@/components/ui/states'
import { AppLayout } from '@/components/layout/AppLayout'
import { DisplaySettingsSync, SessionProvider, useMe } from '@/app/session'
import { PwaPrompts } from '@/app/PwaPrompts'
import { ReconsentGate } from '@/app/ReconsentGate'
import Landing from '@/pages/Landing'
import Home from '@/pages/Home'

// 初回に読み込む JavaScript を 200KB 以下に保つため、ホーム以外は遅延読み込み（18.1）
const Login = lazy(() => import('@/pages/Login'))
const Onboarding = lazy(() => import('@/pages/Onboarding'))
const Search = lazy(() => import('@/pages/Search'))
const WorkDetail = lazy(() => import('@/pages/WorkDetail'))
const Post = lazy(() => import('@/pages/Post'))
const MyWorks = lazy(() => import('@/pages/MyWorks'))
const Profile = lazy(() => import('@/pages/Profile'))
const MyPage = lazy(() => import('@/pages/MyPage'))
const Notifications = lazy(() => import('@/pages/Notifications'))
const News = lazy(() => import('@/pages/News'))
const Settings = lazy(() => import('@/pages/Settings'))
const Restricted = lazy(() => import('@/pages/Restricted'))
const Legal = lazy(() => import('@/pages/Legal'))
const TalkShell = lazy(() => import('@/pages/talk/TalkList').then((m) => ({ default: m.TalkShell })))
const TalkRoom = lazy(() => import('@/pages/talk/TalkRoom'))
const TalkSettings = lazy(() => import('@/pages/talk/TalkExtras').then((m) => ({ default: m.TalkSettings })))
const GroupCreate = lazy(() => import('@/pages/talk/TalkExtras').then((m) => ({ default: m.GroupCreate })))
const AddFriend = lazy(() => import('@/pages/talk/TalkExtras').then((m) => ({ default: m.AddFriend })))
const Requests = lazy(() => import('@/pages/talk/TalkExtras').then((m) => ({ default: m.Requests })))
const InviteLanding = lazy(() => import('@/pages/talk/TalkExtras').then((m) => ({ default: m.InviteLanding })))
const AdminLayout = lazy(() => import('@/pages/admin/AdminLayout'))
const AdminLogin = lazy(() => import('@/pages/admin/AdminLayout').then((m) => ({ default: m.AdminLogin })))
const Dashboard = lazy(() => import('@/pages/admin/Dashboard'))
const AdminUsers = lazy(() => import('@/pages/admin/Users'))
const AdminUserDetail = lazy(() => import('@/pages/admin/Users').then((m) => ({ default: m.UserDetail })))
const AdminReports = lazy(() => import('@/pages/admin/Moderation').then((m) => ({ default: m.Reports })))
const AdminWorks = lazy(() => import('@/pages/admin/Moderation').then((m) => ({ default: m.WorksAdmin })))
const BroadcastList = lazy(() => import('@/pages/admin/Broadcasts').then((m) => ({ default: m.BroadcastList })))
const BroadcastCompose = lazy(() => import('@/pages/admin/Broadcasts').then((m) => ({ default: m.BroadcastCompose })))
const BroadcastReport = lazy(() => import('@/pages/admin/Broadcasts').then((m) => ({ default: m.BroadcastReport })))
const NewsAdmin = lazy(() => import('@/pages/admin/AdminOps').then((m) => ({ default: m.NewsAdmin })))
const SupportInbox = lazy(() => import('@/pages/admin/AdminOps').then((m) => ({ default: m.SupportInbox })))
const BannersAdmin = lazy(() => import('@/pages/admin/AdminOps').then((m) => ({ default: m.BannersAdmin })))
const Masters = lazy(() => import('@/pages/admin/AdminOps').then((m) => ({ default: m.Masters })))
const Members = lazy(() => import('@/pages/admin/AdminOps').then((m) => ({ default: m.Members })))
const Audit = lazy(() => import('@/pages/admin/AdminOps').then((m) => ({ default: m.Audit })))
const SystemSettings = lazy(() => import('@/pages/admin/AdminOps').then((m) => ({ default: m.SystemSettings })))

function Loading() {
  return (
    <div className="flex min-h-[50dvh] items-center justify-center">
      <Spinner />
    </div>
  )
}

/** ログインが必要な画面。未ログインならログインへ、オンボーディング未完了ならオンボーディングへ */
function RequireAuth({ children }: { children?: ReactNode }) {
  const me = useMe()
  const location = useLocation()
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!me.onboarded && location.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />
  return <>{children ?? <Outlet />}</>
}

/** 全体の外枠：メンテナンス、規約の再同意、PWA の案内 */
function Root() {
  const me = useMe()
  const maintenance = useSync(() => api.app.settings().maintenance)
  const isAdmin = useSync(() => !!api.auth.adminRole())
  const location = useLocation()
  useEffect(() => {
    startBackgroundJobs()
    void outbox.flush()
  }, [])
  if (maintenance.enabled && !isAdmin && !location.pathname.startsWith('/admin') && location.pathname !== '/login')
    return <MaintenanceScreen until={maintenance.until} message={maintenance.message} />
  return (
    <SessionProvider>
      <DisplaySettingsSync />
      <Suspense fallback={<Loading />}>
        <Outlet />
      </Suspense>
      {me && <ReconsentGate />}
      <PwaPrompts />
    </SessionProvider>
  )
}

const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <FullError title="問題が発生しました" body="時間をおいて、もう一度お試しください" onRetry={() => location.reload()} />,
    children: [
      { path: '/', element: <Landing /> },
      { path: '/login', element: <Login /> },
      {
        path: '/onboarding',
        element: (
          <RequireAuth>
            <Onboarding />
          </RequireAuth>
        ),
      },
      { path: '/admin/login', element: <AdminLogin /> },
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: 'users', element: <AdminUsers /> },
          { path: 'users/:id', element: <AdminUserDetail /> },
          { path: 'reports', element: <AdminReports /> },
          { path: 'works', element: <AdminWorks /> },
          { path: 'broadcasts', element: <BroadcastList /> },
          { path: 'broadcasts/new', element: <BroadcastCompose /> },
          { path: 'broadcasts/:id', element: <BroadcastCompose /> },
          { path: 'broadcasts/:id/report', element: <BroadcastReport /> },
          { path: 'news', element: <NewsAdmin /> },
          { path: 'support', element: <SupportInbox /> },
          { path: 'banners', element: <BannersAdmin /> },
          { path: 'masters', element: <Masters /> },
          { path: 'members', element: <Members /> },
          { path: 'audit', element: <Audit /> },
          { path: 'settings', element: <SystemSettings /> },
        ],
      },
      {
        element: <AppLayout />,
        children: [
          { path: '/home', element: <Home /> },
          // 未ログインでも作品と公開プロフィールは見られる（13.1）
          { path: '/search', element: <Search /> },
          { path: '/works/:id', element: <WorkDetail /> },
          { path: '/u/:handle', element: <Profile /> },
          { path: '/news', element: <News /> },
          { path: '/legal/:doc', element: <Legal /> },
          { path: '/share-target', element: <ShareTarget /> },
          {
            element: <RequireAuth />,
            children: [
              { path: '/post', element: <Post /> },
              { path: '/post/:id', element: <Post /> },
              { path: '/me', element: <MyPage /> },
              { path: '/me/works', element: <MyWorks /> },
              { path: '/notifications', element: <Notifications /> },
              { path: '/settings', element: <Settings /> },
              { path: '/settings/:section', element: <Settings /> },
              { path: '/restricted', element: <Restricted /> },
              { path: '/friends/add', element: <AddFriend /> },
              { path: '/talk/requests', element: <Requests /> },
              { path: '/talk/new-group', element: <GroupCreate /> },
              { path: '/talk/:roomId/settings', element: <TalkSettings /> },
              { path: '/invite/:token', element: <InviteLanding /> },
              {
                path: '/talk',
                element: <TalkShell />,
                children: [{ path: ':roomId', element: <TalkRoom /> }],
              },
            ],
          },
          { path: '*', element: <FullError title="ページが見つかりません" body="URLが正しいか確認してください" /> },
        ],
      },
    ],
  },
])

/** Web Share Target：他のアプリから共有された URL を「作品として投稿」に渡す（15.4） */
function ShareTarget() {
  const params = new URLSearchParams(location.search)
  const url = params.get('url') ?? params.get('text')?.match(/https?:\/\/\S+/)?.[0] ?? ''
  return <Navigate to={url ? `/post?type=hp&url=${encodeURIComponent(url)}` : '/home'} replace />
}

export default function App() {
  return (
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  )
}
