import { useRef, useState } from 'react'
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom'
import { Search, UserPlus, Users, Pin, BellOff, EyeOff, CheckCheck, Inbox, X, MessageSquareText } from 'lucide-react'
import { api, errorMessage, type RoomFilter, type RoomSummary } from '@/lib/api'
import { useLive, useSync } from '@/hooks/useLive'
import { useDebounced, useIsTablet, haptic } from '@/hooks/misc'
import { PageHeader } from '@/components/layout/AppLayout'
import { Avatar, Button, IconButton, Tabs } from '@/components/ui/primitives'
import { EmptyState, FullError } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { formatListTime } from '@/lib/format'
import { cn } from '@/lib/cn'

/** トークの外枠：タブレットは2ペイン、PCは3ペイン（13.1） */
export function TalkShell() {
  const { roomId } = useParams()
  const wide = useIsTablet()
  const caps = useSync(() => api.users.myCapabilities())
  if (caps && !caps.canViewTalks && !roomId)
    return (
      <div>
        <PageHeader title="トーク" />
        <FullError title="トークの利用は停止されています" body="公式アカウントとのトークは利用できます。詳細は設定の「利用制限」をご確認ください" />
        <div className="flex justify-center">
          <Link to={`/talk/${api.chat.officialRoomId()}`}>
            <Button variant="secondary">公式アカウントのトーク</Button>
          </Link>
        </div>
      </div>
    )
  if (!wide) return roomId ? <Outlet /> : <TalkList />
  return (
    <div className="flex h-full">
      <div className="w-[340px] shrink-0 overflow-y-auto border-r border-subtle xl:w-[380px]">
        <TalkList compact />
      </div>
      <div className="min-w-0 flex-1">
        {roomId ? <Outlet /> : <EmptyState art="chat" title="トークを選んでください" body="左のリストからトークを開きます" />}
      </div>
    </div>
  )
}

/** U-10 トークリスト（14.6） */
export function TalkList({ compact }: { compact?: boolean }) {
  const [filter, setFilter] = useState<RoomFilter>('all')
  const [searching, setSearching] = useState(false)
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 250)
  const { data, loading } = useLive(() => api.chat.listRooms(filter), [filter])
  const results = useLive(() => (dq ? api.chat.search(dq) : Promise.resolve([])), [dq])
  const requests = useSync(() => api.chat.requestCount())
  const navigate = useNavigate()
  const { roomId } = useParams()

  return (
    <div className={cn(!compact && 'pb-4')}>
      <PageHeader
        title="トーク"
        actions={
          <>
            <IconButton label="トークを検索" onClick={() => setSearching((v) => !v)}>
              <Search className="size-5" strokeWidth={1.75} />
            </IconButton>
            <IconButton label="友だち追加" onClick={() => navigate('/friends/add')}>
              <UserPlus className="size-5" strokeWidth={1.75} />
            </IconButton>
            <IconButton label="グループ作成" onClick={() => navigate('/talk/new-group')}>
              <Users className="size-5" strokeWidth={1.75} />
            </IconButton>
          </>
        }
      >
        {searching && (
          <div className="px-4 pb-2">
            <div className="relative">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ルーム名、相手名、メッセージ本文"
                aria-label="トーク横断検索"
                className="min-h-11 w-full rounded-full border border-subtle bg-surface px-4 pr-10"
              />
              {q && (
                <button
                  aria-label="消す"
                  className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center"
                  onClick={() => setQ('')}
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          </div>
        )}
        <Tabs
          className="px-2"
          value={filter}
          onChange={setFilter}
          tabs={[
            { value: 'all', label: 'すべて' },
            { value: 'friends', label: '友だち' },
            { value: 'group', label: 'グループ' },
            { value: 'inquiry', label: '問い合わせ' },
            { value: 'official', label: '公式' },
          ]}
        />
      </PageHeader>

      {searching && dq ? (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {(results.data ?? []).map((r, i) => (
            <li key={`${r.room.room.id}-${r.message?.id ?? 'room'}-${i}`}>
              <Link
                to={`/talk/${r.room.room.id}${r.message ? `?m=${r.message.id}` : ''}`}
                className="flex min-h-16 items-center gap-3 px-4 py-2 hover:bg-surface"
              >
                <RoomAvatar s={r.room} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-m font-bold">{r.room.title}</p>
                  <p className="truncate text-caption text-fg2">{r.message ? r.message.body : 'ルーム名・相手名に一致'}</p>
                </div>
              </Link>
            </li>
          ))}
          {results.data?.length === 0 && <li className="p-8 text-center text-body-m text-fg2">見つかりませんでした</li>}
        </ul>
      ) : (
        <>
          {requests > 0 && (
            <Link to="/talk/requests" className="mx-4 mt-3 flex min-h-12 items-center gap-3 rounded-[12px] bg-surface px-4 text-body-m">
              <Inbox className="size-5 text-brand-text" />
              <span className="flex-1">メッセージリクエスト</span>
              <span className="rounded-full bg-danger px-2 text-caption font-bold text-white tabular">{requests}</span>
            </Link>
          )}
          {loading && !data ? (
            <div className="space-y-1 p-2">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 p-2">
                  <div className="skeleton size-12 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="skeleton h-3.5 w-1/3 rounded" />
                    <div className="skeleton h-3 w-2/3 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : data?.length === 0 ? (
            <EmptyState art="chat" title="まだトークがありません" action={<Button onClick={() => navigate('/friends/add')}>友だちを追加する</Button>} />
          ) : (
            <ul className="mt-1" role="list">
              {data?.map((s) => (
                <SwipeRow key={s.room.id} s={s} active={s.room.id === roomId} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

export function RoomAvatar({ s, size = 48 }: { s: Pick<RoomSummary, 'room' | 'peer' | 'title'>; size?: number }) {
  if (s.room.kind === 'group')
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-[30%] text-white"
        style={{ width: size, height: size, background: s.room.iconColor }}
        aria-hidden
      >
        <Users className="size-1/2" strokeWidth={1.75} />
      </span>
    )
  return <Avatar name={s.title} color={s.peer?.avatarColor ?? s.room.iconColor} url={s.peer?.avatarUrl} size={size} verified={s.room.kind === 'official'} />
}

/** ZS-CHAT-03 スワイプ操作（PC は右クリック）：ピン留め、通知オフ、非表示、既読にする */
function SwipeRow({ s, active }: { s: RoomSummary; active: boolean }) {
  const [dx, setDx] = useState(0)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const start = useRef<{ x: number; y: number; dx: number } | null>(null)
  const moved = useRef(false)
  const toast = useToast()
  const navigate = useNavigate()
  const W = 240
  const run = async (fn: () => Promise<void>, text?: string, undo?: () => Promise<void>) => {
    setDx(0)
    setMenu(null)
    try {
      await fn()
      if (text) toast({ text, action: undo ? { label: '元に戻す', onClick: () => void undo() } : undefined })
    } catch (e) {
      toast({ text: errorMessage(e), tone: 'error' })
    }
  }
  const actions = [
    { label: s.pinned ? 'ピン解除' : 'ピン留め', icon: Pin, cls: 'bg-brand', fn: () => run(() => api.chat.updateMembership(s.room.id, { pinned: !s.pinned })) },
    {
      label: s.muted ? '通知オン' : '通知オフ',
      icon: BellOff,
      cls: 'bg-[#475569]',
      fn: () => run(() => api.chat.updateMembership(s.room.id, { notifyLevel: s.muted ? 'all' : 'off' })),
    },
    {
      label: '非表示',
      icon: EyeOff,
      cls: 'bg-warning text-on-accent',
      fn: () =>
        run(
          () => api.chat.updateMembership(s.room.id, { hidden: true }),
          'トークを非表示にしました',
          () => api.chat.updateMembership(s.room.id, { hidden: false }),
        ),
    },
    { label: '既読にする', icon: CheckCheck, cls: 'bg-aurora text-on-accent', fn: () => run(() => api.chat.markRead(s.room.id)) },
  ].filter((a) => !(s.room.kind === 'official' && a.label === '非表示'))

  return (
    <li className="relative overflow-hidden" onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY }))}>
      <div className="absolute inset-y-0 right-0 flex" style={{ width: W }} aria-hidden={dx === 0}>
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={a.fn}
            className={cn('flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold text-white', a.cls)}
            tabIndex={dx === 0 ? -1 : 0}
          >
            <a.icon className="size-5" />
            {a.label}
          </button>
        ))}
      </div>
      <div
        className={cn(
          'relative bg-base transition-transform',
          start.current ? 'duration-0' : 'duration-300 ease-[var(--ease-standard)]',
          active && 'bg-surface',
        )}
        style={{ transform: `translateX(${dx}px)`, touchAction: 'pan-y' }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return
          start.current = { x: e.clientX, y: e.clientY, dx }
          moved.current = false
        }}
        onPointerMove={(e) => {
          if (!start.current) return
          const ddx = e.clientX - start.current.x
          if (Math.abs(ddx) > 8 && Math.abs(ddx) > Math.abs(e.clientY - start.current.y)) moved.current = true
          if (moved.current) setDx(Math.max(-W, Math.min(0, start.current.dx + ddx)))
        }}
        onPointerUp={() => {
          if (!start.current) return
          const open = dx < -W / 3
          if (open && start.current.dx === 0) haptic(8)
          setDx(open ? -W : 0)
          start.current = null
        }}
        onPointerCancel={() => {
          start.current = null
          setDx(0)
        }}
      >
        <Link
          to={`/talk/${s.room.id}`}
          onClick={(e) => {
            if (moved.current || dx !== 0) {
              e.preventDefault()
              setDx(0)
              moved.current = false
            }
          }}
          className="flex min-h-[72px] items-center gap-3 px-4 py-2 hover:bg-surface"
        >
          <RoomAvatar s={s} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-body-m font-bold">{s.title}</span>
              {s.room.kind === 'group' && <span className="shrink-0 text-caption text-fg2 tabular">({s.room.memberCount})</span>}
              {s.room.kind === 'inquiry' && <span className="shrink-0 rounded-full bg-aurora/15 px-1.5 text-[10px] font-bold text-aurora">問い合わせ</span>}
              {s.room.kind === 'official' && <span className="shrink-0 rounded-full bg-brand/20 px-1.5 text-[10px] font-bold text-brand-text">公式</span>}
              {s.pinned && <Pin className="size-3.5 shrink-0 text-fg2" aria-label="ピン留め" />}
              {s.muted && <BellOff className="size-3.5 shrink-0 text-fg2" aria-label="通知オフ" />}
            </div>
            <p className={cn('truncate text-body-m', s.unread ? 'text-fg' : 'text-fg2')}>{s.lastMessagePreview || ' '}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-caption text-fg2 tabular">{formatListTime(s.lastMessageAt)}</span>
            {s.room.kind === 'inquiry' && s.work?.media[0] && <img src={s.work.media[0].thumbUrl} alt="" className="h-6 w-9 rounded object-cover" />}
            {s.unread > 0 && (
              <span
                className={cn(
                  'min-w-[20px] rounded-full px-1.5 text-center text-[11px] font-bold leading-5 tabular',
                  s.muted ? 'bg-fg2/40 text-white' : 'bg-danger text-white',
                )}
                aria-label={`未読${s.unread}件`}
              >
                {s.unread > 99 ? '99+' : s.unread}
              </span>
            )}
          </div>
        </Link>
      </div>
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div
            className="fixed z-50 w-48 overflow-hidden rounded-[12px] border border-subtle bg-elevated py-1 shadow-xl"
            style={{ left: Math.min(menu.x, innerWidth - 200), top: Math.min(menu.y, innerHeight - 200) }}
            role="menu"
          >
            <button
              role="menuitem"
              className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-body-m hover:bg-surface"
              onClick={() => navigate(`/talk/${s.room.id}`)}
            >
              <MessageSquareText className="size-4" /> 開く
            </button>
            {actions.map((a) => (
              <button
                key={a.label}
                role="menuitem"
                onClick={a.fn}
                className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-body-m hover:bg-surface"
              >
                <a.icon className="size-4" /> {a.label}
              </button>
            ))}
          </div>
        </>
      )}
    </li>
  )
}
