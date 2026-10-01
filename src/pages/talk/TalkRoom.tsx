import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ChevronLeft,
  Search,
  Menu,
  Plus,
  SendHorizonal,
  Image as ImageIcon,
  LayoutGrid,
  Clock,
  AlertCircle,
  Reply,
  Copy,
  Undo2,
  Trash2,
  Flag,
  Megaphone,
  X,
  ChevronDown,
  Keyboard,
  Newspaper,
  HelpCircle,
  MessageCircleQuestion,
  Bell,
  ShieldAlert,
} from 'lucide-react'
import { api, errorMessage, type RoomDetail } from '@/lib/api'
import { useLive, useSync } from '@/hooks/useLive'
import { useOnline, haptic, useIsTablet } from '@/hooks/misc'
import { useMe } from '@/app/session'
import { Avatar, Button, IconButton, Sheet } from '@/components/ui/primitives'
import { FullError } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { Linkified } from '@/components/Linkified'
import { ReportSheet } from '@/components/ReportSheet'
import { WorkCard } from '@/components/work/WorkCard'
import { RoomAvatar } from './TalkList'
import { outbox, type OutboxItem } from '@/lib/outbox'
import { checkNgWords } from '@/lib/ngwords'
import { formatDaySeparator, formatTime, jstDateKey } from '@/lib/format'
import { INQUIRY_TEMPLATES, LIMITS, OFFICIAL_USER_ID, REACTIONS } from '@/lib/constants'
import { canSendInRoom, restrictionMessage } from '@/lib/restrictions'
import { uuid } from '@/lib/ids'
import { markPushAsked, pushAskedAlready, requestPushPermission } from '@/lib/pwa'
import type { Bubble, Message, RichCard } from '@/lib/types'
import { cn } from '@/lib/cn'

type LocalMessage = Message & { local?: OutboxItem['status'] }

const draftKey = (roomId: string) => `zenospace:draft:${roomId}`

function useOutbox(roomId: string): OutboxItem[] {
  const snap = useRef<{ key: string; list: OutboxItem[] }>({ key: '', list: [] })
  return useSyncExternalStore(outbox.subscribe, () => {
    const list = outbox.list(roomId)
    const key = JSON.stringify(list.map((i) => [i.input.clientId, i.status]))
    if (key !== snap.current.key) snap.current = { key, list }
    return snap.current.list
  })
}

/** U-11 トークルーム（14.6）／U-20 公式アカウントのトーク（14.7） */
export default function TalkRoom() {
  const { roomId = '' } = useParams()
  const room = useLive(() => api.chat.getRoom(roomId), [roomId])
  if (room.error) return <FullError title="トークを開けませんでした" body={errorMessage(room.error)} onRetry={room.reload} />
  if (!room.data) return <div className="flex h-full items-center justify-center text-fg2">読み込み中…</div>
  return <Room key={roomId} detail={room.data} />
}

function Room({ detail }: { detail: RoomDetail }) {
  const { room } = detail
  const me = useMe()!
  const navigate = useNavigate()
  const wide = useIsTablet()
  const [params, setParams] = useSearchParams()
  const [limit, setLimit] = useState(30)
  const { data } = useLive(() => api.chat.listMessages(room.id, { limit }), [room.id, limit])
  const pending = useOutbox(room.id)
  const restrictions = useSync(() => api.users.myRestrictions())
  const settings = useSync(() => api.users.settings())
  const online = useOnline()
  const toast = useToast()
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const [newCount, setNewCount] = useState(0)
  const lastCount = useRef(0)
  const [reply, setReply] = useState<Message | null>(null)
  const [menuFor, setMenuFor] = useState<Message | null>(null)
  const [reportMsg, setReportMsg] = useState<Message | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [highlight, setHighlight] = useState<number | null>(null)
  const [pushAsk, setPushAsk] = useState(false)
  const isOfficial = room.kind === 'official'

  const messages: LocalMessage[] = useMemo(() => {
    const server = data?.messages ?? []
    const ids = new Set(server.map((m) => m.clientId))
    const local = pending
      .filter((p) => !ids.has(p.input.clientId))
      .map<LocalMessage>((p) => ({
        id: -Date.parse(p.createdAt),
        roomId: room.id,
        senderId: me.id,
        kind: p.input.kind ?? 'text',
        body: p.input.body,
        replyToId: p.input.replyToId ?? null,
        meta: p.input.meta ?? {},
        clientId: p.input.clientId,
        createdAt: p.createdAt,
        unsentAt: null,
        local: p.status,
      }))
    return [...server, ...local]
  }, [data, pending, room.id, me.id])

  // 既読：開いたとき、最下部で新着を受け取ったとき
  useEffect(() => {
    if (atBottom.current && document.visibilityState === 'visible') void api.chat.markRead(room.id)
  }, [room.id, data])
  useEffect(() => {
    const on = () => document.visibilityState === 'visible' && atBottom.current && void api.chat.markRead(room.id)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [room.id])

  // 新着：最下部にいれば追従、遡っていれば「新着メッセージ N件」
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const count = messages.length
    const added = count - lastCount.current
    const mineLast = messages[count - 1]?.senderId === me.id
    if (lastCount.current === 0 || atBottom.current || mineLast) el.scrollTop = el.scrollHeight
    else if (added > 0) setNewCount((n) => n + added)
    lastCount.current = count
  }, [messages, me.id])

  // 検索結果などから特定のメッセージへ移動
  useEffect(() => {
    const m = Number(params.get('m'))
    if (m) jumpTo(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, data])

  const jumpTo = useCallback(
    (id: number) => {
      const el = document.getElementById(`m-${id}`)
      if (!el) {
        if (data?.hasMore) setLimit((l) => l + 100)
        return
      }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setHighlight(id)
      setTimeout(() => setHighlight(null), 1600)
    },
    [data?.hasMore],
  )

  const onScroll = () => {
    const el = scroller.current!
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (atBottom.current && newCount) {
      setNewCount(0)
      void api.chat.markRead(room.id)
    }
    if (el.scrollTop < 60 && data?.hasMore) {
      const prevH = el.scrollHeight
      setLimit((l) => l + 30)
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight - prevH + el.scrollTop
      })
    }
  }

  const canSend = detail.canSend && canSendInRoom(restrictions, isOfficial)
  const chatRestriction = restrictions.find((r) => r.kind === 'chat_send' || r.kind === 'chat_all')

  const send = async (input: { body: string; kind?: Message['kind']; meta?: Message['meta'] }) => {
    const clientId = uuid()
    const replyToId = reply?.id && reply.id > 0 ? reply.id : null
    setReply(null)
    atBottom.current = true
    haptic(5)
    await outbox.send(room.id, { ...input, replyToId, clientId })
    const failed = outbox.list(room.id).find((i) => i.input.clientId === clientId && i.status === 'failed')
    if (failed) toast({ text: failed.error ?? '送信できませんでした。タップすると再送します', tone: 'error' })
    else if (!pushAskedAlready() && !isOfficial) setPushAsk(true) // ZS-NOTIF-03 最初のメッセージ送信後に許可を求める
  }

  const title = detail.title + (room.kind === 'group' ? ` (${room.memberCount})` : '')
  const showTemplates = params.get('inquiry') === '1' && room.kind === 'inquiry' && !messages.some((m) => m.senderId === me.id && m.kind === 'text')

  return (
    <div className="relative flex h-full flex-col">
      <header className="glass z-20 shrink-0 border-b border-subtle">
        <div className="flex h-14 items-center gap-1 px-2">
          <IconButton label="戻る" onClick={() => navigate('/talk')} className={cn(wide && 'sm:hidden')}>
            <ChevronLeft className="size-6" strokeWidth={1.75} />
          </IconButton>
          <Link
            to={detail.peer && !isOfficial ? `/u/${detail.peer.handle}` : `/talk/${room.id}/settings`}
            className="flex min-w-0 flex-1 items-center gap-2 px-1"
          >
            <RoomAvatar s={{ room, peer: detail.peer, title: detail.title }} size={32} />
            <span className="truncate text-body-l font-bold">{title}</span>
            {room.kind === 'inquiry' && <span className="shrink-0 rounded-full bg-aurora/15 px-1.5 text-[10px] font-bold text-aurora">問い合わせ</span>}
          </Link>
          <IconButton label="ルーム内検索" onClick={() => setSearchOpen(true)}>
            <Search className="size-5" strokeWidth={1.75} />
          </IconButton>
          <IconButton label="メニュー" onClick={() => navigate(`/talk/${room.id}/settings`)}>
            <Menu className="size-5" strokeWidth={1.75} />
          </IconButton>
        </div>
        {!online && <div className="bg-warning px-3 py-1 text-center text-caption text-black">オフラインです。送信は接続が戻ったら自動で行います</div>}
        {detail.work && room.kind === 'inquiry' && (
          <div className="border-t border-subtle px-3 py-2">
            <WorkCard work={detail.work} owner={api.users.profileSync(detail.work.ownerId)!} size="S" />
          </div>
        )}
        {detail.announcements.length > 0 && (
          <div className="space-y-1 border-t border-subtle px-3 py-2">
            {detail.announcements.map((a) => (
              <button key={a.id} onClick={() => jumpTo(a.id)} className="flex w-full items-center gap-2 text-left text-caption">
                <Megaphone className="size-4 shrink-0 text-aurora" />
                <span className="truncate">{a.body}</span>
              </button>
            ))}
          </div>
        )}
      </header>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
        aria-live="polite"
        aria-relevant="additions"
      >
        {data?.hasMore && <p className="py-2 text-center text-caption text-fg2">さらに読み込み中…</p>}
        <MessageList
          messages={messages}
          detail={detail}
          meId={me.id}
          highlight={highlight}
          onLongPress={setMenuFor}
          onReply={(m) => setReply(m)}
          onJump={jumpTo}
          onRetry={(cid) => outbox.retry(cid)}
          onDiscard={(cid) => outbox.discard(cid)}
        />
      </div>

      {newCount > 0 && (
        <button
          className="anim-rise absolute bottom-24 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-brand px-4 py-2 text-label text-white shadow-lg"
          onClick={() => {
            scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
            setNewCount(0)
          }}
        >
          新着メッセージ {newCount}件 <ChevronDown className="size-4" />
        </button>
      )}

      {showTemplates && (
        <div className="no-scrollbar flex shrink-0 gap-2 overflow-x-auto border-t border-subtle px-3 py-2">
          {INQUIRY_TEMPLATES.map((t) => (
            <button
              key={t.key}
              className="min-h-9 shrink-0 rounded-full border border-subtle bg-surface px-3 text-label"
              onClick={() => window.dispatchEvent(new CustomEvent('zs:template', { detail: t.text }))}
            >
              {t.label}
            </button>
          ))}
          <button className="min-h-9 shrink-0 px-2 text-caption text-fg2" onClick={() => setParams({}, { replace: true })}>
            閉じる
          </button>
        </div>
      )}

      {canSend ? (
        isOfficial ? (
          <OfficialComposer roomId={room.id} onSend={send} enterToSend={settings?.enterToSend ?? true} />
        ) : (
          <Composer
            roomId={room.id}
            reply={reply}
            onCancelReply={() => setReply(null)}
            onSend={send}
            enterToSend={settings?.enterToSend ?? true}
            detail={detail}
          />
        )
      ) : (
        <div className="shrink-0 border-t border-subtle p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className="flex items-start gap-2 rounded-[14px] border-2 border-warning bg-warning/10 px-3 py-2.5 text-body-m" role="status">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" />
            <span className="flex-1">
              {chatRestriction
                ? restrictionMessage(chatRestriction)
                : detail.peer
                  ? 'この相手にはメッセージを送れません'
                  : '退会したユーザーにはメッセージを送れません'}
              {chatRestriction && (
                <Link to="/restricted" className="ml-1 text-brand-text underline">
                  詳細
                </Link>
              )}
            </span>
          </div>
        </div>
      )}

      <MessageMenu
        message={menuFor}
        detail={detail}
        meId={me.id}
        onClose={() => setMenuFor(null)}
        onReply={(m) => {
          setReply(m)
          setMenuFor(null)
        }}
        onReport={(m) => {
          setMenuFor(null)
          setReportMsg(m)
        }}
      />
      <ReportSheet
        open={!!reportMsg}
        onClose={() => setReportMsg(null)}
        targetType="message"
        targetId={String(reportMsg?.id ?? '')}
        roomId={room.id}
        targetLabel="メッセージ"
      />
      <RoomSearch open={searchOpen} onClose={() => setSearchOpen(false)} roomId={room.id} onPick={(id) => (setSearchOpen(false), jumpTo(id))} />
      <PushPrompt open={pushAsk} onClose={() => (setPushAsk(false), markPushAsked())} />
    </div>
  )
}

// ---------------------------------------------------------------------------

function MessageList({
  messages,
  detail,
  meId,
  highlight,
  onLongPress,
  onReply,
  onJump,
  onRetry,
  onDiscard,
}: {
  messages: LocalMessage[]
  detail: RoomDetail
  meId: string
  highlight: number | null
  onLongPress: (m: Message) => void
  onReply: (m: Message) => void
  onJump: (id: number) => void
  onRetry: (clientId: string) => void
  onDiscard: (clientId: string) => void
}) {
  const isGroup = detail.room.kind === 'group'
  // 日付ごとにまとめ、区切りのラベルはその日の範囲の中だけで上部に固定する
  const days: { key: string; items: LocalMessage[] }[] = []
  for (const m of messages) {
    const key = jstDateKey(m.createdAt)
    if (days[days.length - 1]?.key !== key) days.push({ key, items: [] })
    days[days.length - 1].items.push(m)
  }
  return (
    <div>
      {days.map((day) => (
        <section key={day.key} aria-label={formatDaySeparator(day.items[0].createdAt)}>
          <div className="sticky top-0 z-10 flex justify-center py-2">
            <span className="rounded-full bg-elevated/90 px-3 py-0.5 text-caption text-fg2 backdrop-blur">{formatDaySeparator(day.items[0].createdAt)}</span>
          </div>
          <ol className="space-y-0.5">
            {day.items.map((m, i) => {
              const prev = day.items[i - 1]
              const next = day.items[i + 1]
              // 同じ人が1分以内に続けて送った吹き出しはまとめる
              const sameAsPrev =
                !!prev &&
                prev.senderId === m.senderId &&
                prev.kind !== 'system' &&
                new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 60_000
              const sameAsNext =
                !!next &&
                next.senderId === m.senderId &&
                next.kind !== 'system' &&
                new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() < 60_000
              return m.kind === 'system' ? (
                <li key={m.clientId} className="py-2 text-center text-caption text-fg2">
                  {m.body}
                </li>
              ) : (
                <MessageRow
                  key={m.clientId}
                  m={m}
                  detail={detail}
                  mine={m.senderId === meId}
                  showHead={isGroup && !sameAsPrev && m.senderId !== meId}
                  showTime={!sameAsNext}
                  tightTop={sameAsPrev}
                  highlight={highlight === m.id}
                  onLongPress={onLongPress}
                  onReply={onReply}
                  onJump={onJump}
                  onRetry={onRetry}
                  onDiscard={onDiscard}
                />
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}

function MessageRow({
  m,
  detail,
  mine,
  showHead,
  showTime,
  tightTop,
  highlight,
  onLongPress,
  onReply,
  onJump,
  onRetry,
  onDiscard,
}: {
  m: LocalMessage
  detail: RoomDetail
  mine: boolean
  showHead: boolean
  showTime: boolean
  tightTop: boolean
  highlight: boolean
  onLongPress: (m: Message) => void
  onReply: (m: Message) => void
  onJump: (id: number) => void
  onRetry: (clientId: string) => void
  onDiscard: (clientId: string) => void
}) {
  const sender = useSync(() => api.users.profileSync(m.senderId))
  const reactions = useSync(() => (m.id > 0 ? api.chat.reactionsOf(m.id) : []))
  const readCount = useSync(() => (mine && m.id > 0 ? api.chat.readCount(detail.room.id, m) : 0))
  const replyTo = useSync(() => (m.replyToId ? api.chat.messageSync(m.replyToId) : undefined))
  const [dx, setDx] = useState(0)
  const [pressed, setPressed] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isGroup = detail.room.kind === 'group'
  const isOfficialMsg = m.senderId === OFFICIAL_USER_ID
  const canInteract = m.id > 0 && !m.unsentAt && m.id < 1_000_000_000

  const readLabel = mine && m.id > 0 && readCount > 0 ? (isGroup ? `既読 ${readCount}` : '既読') : null
  const senderName = isOfficialMsg
    ? m.meta.fromAdmin
      ? `運営チーム${m.meta.fromAdmin.name ? `（${m.meta.fromAdmin.name}）` : ''}`
      : 'zenospace 公式'
    : sender?.deletedAt
      ? '退会したユーザー'
      : (sender?.displayName ?? '')

  const meta = (
    <span className={cn('flex shrink-0 flex-col justify-end pb-0.5 text-[11px] leading-tight text-fg2 tabular', mine ? 'items-end' : 'items-start')}>
      {m.local === 'pending' || m.local === 'sending' ? (
        <Clock className="size-3" aria-label="送信待ち" />
      ) : m.local === 'failed' ? null : (
        <>
          {readLabel && <span className="anim-fade">{readLabel}</span>}
          {showTime && <time dateTime={m.createdAt}>{formatTime(m.createdAt)}</time>}
        </>
      )}
    </span>
  )

  const radius = mine ? (tightTop ? 'rounded-[18px] rounded-tr-[6px]' : 'rounded-[18px]') : tightTop ? 'rounded-[18px] rounded-tl-[6px]' : 'rounded-[18px]'

  // 読み上げは「送信者、時刻、既読、本文」の順（15.2）
  const srLabel = `${mine ? 'あなた' : senderName}、${formatTime(m.createdAt)}${readLabel ? `、${readLabel}` : ''}`

  return (
    <li
      id={`m-${m.id}`}
      className={cn('anim-rise flex gap-2', mine ? 'justify-end' : 'justify-start', tightTop ? 'mt-0.5' : 'mt-3', highlight && 'rounded-[12px] bg-brand/15')}
      aria-label={srLabel}
    >
      {!mine && (isGroup || detail.room.kind === 'official') && (
        <div className="w-9 shrink-0">
          {showHead || (detail.room.kind === 'official' && !tightTop) ? (
            <Avatar name={senderName} color={sender?.avatarColor} url={sender?.avatarUrl} size={36} verified={isOfficialMsg} />
          ) : null}
        </div>
      )}
      <div className={cn('flex max-w-[78%] flex-col sm:max-w-[65%]', mine ? 'items-end' : 'items-start')}>
        {(showHead || (isOfficialMsg && m.meta.fromAdmin && !tightTop)) && <span className="mb-0.5 px-1 text-caption text-fg2">{senderName}</span>}
        <div className={cn('flex items-end gap-1.5', mine && 'flex-row-reverse')}>
          <div
            className={cn('relative transition-transform duration-150', pressed && 'scale-[1.03]')}
            style={{ transform: dx ? `translateX(${dx}px)` : undefined, touchAction: 'pan-y' }}
            onContextMenu={(e) => {
              if (!canInteract) return
              e.preventDefault()
              onLongPress(m)
            }}
            onPointerDown={(e) => {
              if (!canInteract) return
              start.current = { x: e.clientX, y: e.clientY }
              if (e.pointerType !== 'mouse')
                timer.current = setTimeout(() => {
                  setPressed(true)
                  haptic(15)
                  onLongPress(m)
                  setTimeout(() => setPressed(false), 200)
                }, 450)
            }}
            onPointerMove={(e) => {
              if (!start.current) return
              const ddx = e.clientX - start.current.x
              if (Math.abs(ddx) > 6 || Math.abs(e.clientY - start.current.y) > 6) timer.current && clearTimeout(timer.current)
              // 右スワイプで引用返信：指に最大64px追従
              if (ddx > 0 && Math.abs(ddx) > Math.abs(e.clientY - start.current.y)) {
                const v = Math.min(64, ddx)
                if (v >= 48 && dx < 48) haptic(8)
                setDx(v)
              }
            }}
            onPointerUp={() => {
              timer.current && clearTimeout(timer.current)
              if (dx >= 48) onReply(m)
              setDx(0)
              start.current = null
            }}
            onPointerCancel={() => {
              timer.current && clearTimeout(timer.current)
              setDx(0)
              start.current = null
            }}
          >
            {dx > 0 && <Reply className="absolute -left-8 top-1/2 size-5 -translate-y-1/2 text-fg2" style={{ opacity: dx / 48 }} />}
            {m.unsentAt ? (
              <div className={cn('border border-subtle px-3.5 py-2 text-body-m italic text-fg2', radius)}>メッセージの送信を取り消しました</div>
            ) : (
              <BubbleBody m={m} mine={mine} radius={radius} replyTo={replyTo} onJump={onJump} />
            )}
            {/* PC：ホバーメニュー */}
            {canInteract && (
              <div
                className={cn(
                  'absolute top-1/2 hidden -translate-y-1/2 gap-0.5 opacity-0 transition-opacity [@media(hover:hover)]:flex [li:hover_&]:opacity-100',
                  mine ? 'right-full mr-14' : 'left-full ml-14',
                )}
              >
                <IconButton label="返信" className="size-8 bg-elevated" onClick={() => onReply(m)}>
                  <Reply className="size-4" />
                </IconButton>
                <IconButton label="その他" className="size-8 bg-elevated" onClick={() => onLongPress(m)}>
                  <Menu className="size-4" />
                </IconButton>
              </div>
            )}
          </div>
          {meta}
        </div>
        {m.local === 'failed' && (
          <div className="mt-1 flex items-center gap-2 text-caption text-danger">
            <AlertCircle className="size-3.5" />
            <button className="underline" onClick={() => onRetry(m.clientId)}>
              送信できませんでした。タップすると再送します
            </button>
            <button className="text-fg2 underline" onClick={() => onDiscard(m.clientId)}>
              削除
            </button>
          </div>
        )}
        {reactions.length > 0 && <ReactionChips reactions={reactions} messageId={m.id} />}
      </div>
    </li>
  )
}

function BubbleBody({ m, mine, radius, replyTo, onJump }: { m: Message; mine: boolean; radius: string; replyTo?: Message; onJump: (id: number) => void }) {
  const bubbleCls = cn(
    'px-3.5 py-2 text-body-l whitespace-pre-wrap break-words',
    radius,
    mine
      ? 'bg-brand text-white'
      : m.senderId === OFFICIAL_USER_ID
        ? 'bg-bubble-official border border-subtle relative overflow-hidden'
        : 'bg-bubble-other text-fg',
  )
  const quote = replyTo && (
    <button
      onClick={() => onJump(replyTo.id)}
      className={cn('mb-1 block w-full border-l-2 pl-2 text-left text-caption', mine ? 'border-white/60 text-white/80' : 'border-brand-text text-fg2')}
    >
      <span className="block font-bold">{api.app.profileName(replyTo.senderId)}</span>
      <span className="line-clamp-1">
        {replyTo.unsentAt ? '取り消されたメッセージ' : replyTo.kind === 'image' ? '写真' : replyTo.kind === 'work' ? '作品' : replyTo.body}
      </span>
    </button>
  )
  const officialLine = m.senderId === OFFICIAL_USER_ID && <span className="bg-signature absolute inset-y-0 left-0 w-0.5" aria-hidden />

  switch (m.kind) {
    case 'image':
      return <ImageGrid images={m.meta.images ?? []} radius={radius} />
    case 'work': {
      const w = api.works.workSync(m.meta.workId ?? '')
      const owner = w && api.users.profileSync(w.ownerId)
      return w && owner ? (
        <div className="w-72 max-w-full">
          <WorkCard work={w} owner={owner} size="S" />
        </div>
      ) : (
        <div className={bubbleCls}>削除された作品</div>
      )
    }
    case 'rich':
      return <RichBubble bubble={m.meta.bubble!} broadcastId={m.meta.broadcastId} />
    default:
      return (
        <div className={bubbleCls}>
          {officialLine}
          {quote}
          <Linkified text={m.body} senderId={m.senderId} />
        </div>
      )
  }
}

/** 画像：2〜4枚は格子、5枚以上は4枚目に「+N」。タップで全画面 */
function ImageGrid({ images, radius }: { images: NonNullable<Message['meta']['images']>; radius: string }) {
  const [open, setOpen] = useState<number | null>(null)
  const shown = images.slice(0, 4)
  const rest = images.length - 4
  return (
    <>
      <div className={cn('grid w-64 max-w-full gap-0.5 overflow-hidden', radius, images.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
        {shown.map((img, i) => (
          <button key={i} className="relative" onClick={() => setOpen(i)} aria-label={img.alt || `画像 ${i + 1}/${images.length}`}>
            <img
              src={img.thumbUrl}
              alt={img.alt || `画像 ${i + 1}/${images.length}`}
              className={cn('w-full object-cover', images.length === 1 ? 'max-h-80' : 'aspect-square')}
              loading="lazy"
            />
            {i === 3 && rest > 0 && <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-title-m text-white">+{rest}</span>}
          </button>
        ))}
      </div>
      {open !== null && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-label="画像ビューア">
          <div className="flex justify-between p-2 text-white">
            <span className="px-3 py-2 tabular">
              {open + 1}/{images.length}
            </span>
            <IconButton label="閉じる" className="text-white" onClick={() => setOpen(null)}>
              <X className="size-6" />
            </IconButton>
          </div>
          <div
            className="no-scrollbar flex flex-1 snap-x snap-mandatory overflow-x-auto"
            style={{ touchAction: 'pan-x pinch-zoom' }}
            ref={(el) => el?.scrollTo({ left: el.clientWidth * open })}
          >
            {images.map((img, i) => (
              <img key={i} src={img.url} alt={img.alt ?? ''} className="h-full w-full shrink-0 snap-center object-contain" />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

/** ZS-OFC-03 リッチメッセージ：テキスト、画像、カード、カルーセル、作品カード */
function RichBubble({ bubble, broadcastId }: { bubble: Bubble; broadcastId?: string }) {
  const navigate = useNavigate()
  const click = (btn: { key: string; url: string }) => {
    if (broadcastId) void api.chat.recordBroadcastClick(broadcastId, btn.key)
    if (btn.url.startsWith('/')) navigate(btn.url)
    else window.open(btn.url, '_blank', 'noopener,noreferrer')
  }
  const Card = ({ c, w = 'w-64' }: { c: RichCard; w?: string }) => (
    <div className={cn('card shrink-0 snap-start overflow-hidden', w)}>
      {c.imageUrl && <img src={c.imageUrl} alt="" className="aspect-[16/10] w-full object-cover" />}
      <div className="space-y-1 p-3">
        <p className="text-body-m font-bold">{c.title}</p>
        {c.body && <p className="text-caption text-fg2">{c.body}</p>}
      </div>
      {c.buttons?.map((b) => (
        <button key={b.key} onClick={() => click(b)} className="block min-h-11 w-full border-t border-subtle text-label text-brand-text hover:bg-elevated">
          {b.label}
        </button>
      ))}
    </div>
  )
  switch (bubble.type) {
    case 'text':
      return (
        <div className="relative overflow-hidden rounded-[18px] border border-subtle bg-bubble-official px-3.5 py-2 text-body-l whitespace-pre-wrap">
          <span className="bg-signature absolute inset-y-0 left-0 w-0.5" aria-hidden />
          <Linkified text={bubble.text} senderId={OFFICIAL_USER_ID} />
        </div>
      )
    case 'image':
      return <img src={bubble.url} alt="" className="w-64 rounded-[18px]" />
    case 'card':
      return <Card c={bubble.card} />
    case 'carousel':
      return (
        <div className="no-scrollbar -mx-12 flex max-w-[100vw] snap-x snap-mandatory gap-2 overflow-x-auto px-12 sm:max-w-[560px]">
          {bubble.cards.map((c, i) => (
            <Card key={i} c={c} w={i === 0 && !c.buttons ? 'w-48 bg-signature !text-white' : 'w-64'} />
          ))}
        </div>
      )
    case 'work': {
      const w = api.works.workSync(bubble.workId)
      const owner = w && api.users.profileSync(w.ownerId)
      return w && owner ? (
        <div className="w-72">
          <WorkCard work={w} owner={owner} size="S" />
        </div>
      ) : null
    }
  }
}

function ReactionChips({ reactions, messageId }: { reactions: { kind: string; userId: string }[]; messageId: number }) {
  const [who, setWho] = useState(false)
  const me = useMe()
  const grouped = REACTIONS.map((r) => ({ ...r, users: reactions.filter((x) => x.kind === r.kind).map((x) => x.userId) })).filter((r) => r.users.length)
  return (
    <>
      <div className="mt-1 flex flex-wrap gap-1">
        {grouped.map((r) => (
          <button
            key={r.kind}
            onClick={() => setWho(true)}
            className={cn(
              'inline-flex min-h-7 items-center gap-1 rounded-full border px-2 text-caption tabular',
              r.users.includes(me?.id ?? '') ? 'border-brand-text bg-brand/15' : 'border-subtle bg-surface',
            )}
            aria-label={`${r.label} ${r.users.length}件`}
          >
            {r.emoji} {r.users.length}
          </button>
        ))}
      </div>
      <Sheet open={who} onClose={() => setWho(false)} title="リアクション" size="sm">
        <ul className="space-y-1">
          {grouped.flatMap((r) =>
            r.users.map((u) => (
              <li key={`${r.kind}-${u}`} className="flex min-h-11 items-center gap-3">
                <span className="text-[20px]">{r.emoji}</span>
                <span className="text-body-m">{api.app.profileName(u)}</span>
              </li>
            )),
          )}
        </ul>
        {grouped.some((r) => r.users.includes(me?.id ?? '')) && (
          <Button variant="ghost" block onClick={() => (api.chat.react(messageId, null), setWho(false))}>
            自分のリアクションを外す
          </Button>
        )}
      </Sheet>
    </>
  )
}

/** 長押しメニュー：上にリアクションバー、下にメニュー（返信、コピー、送信取消、通報） */
function MessageMenu({
  message,
  detail,
  meId,
  onClose,
  onReply,
  onReport,
}: {
  message: Message | null
  detail: RoomDetail
  meId: string
  onClose: () => void
  onReply: (m: Message) => void
  onReport: (m: Message) => void
}) {
  const toast = useToast()
  const caps = useSync(() => api.users.myCapabilities())
  if (!message) return null
  const mine = message.senderId === meId
  const canUnsend = mine && Date.now() - new Date(message.createdAt).getTime() < LIMITS.unsendHours * 3600_000
  const isAdmin = detail.room.kind !== 'group' || detail.me.role !== 'member'
  const pinned = detail.announcements.some((a) => a.id === message.id)
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    onClose()
    try {
      await fn()
      if (ok) toast({ text: ok })
    } catch (e) {
      toast({ text: errorMessage(e), tone: 'error' })
    }
  }
  const item = (icon: React.ReactNode, label: string, fn: () => void, danger?: boolean) => (
    <button
      onClick={fn}
      className={cn('flex min-h-12 w-full items-center gap-3 rounded-[12px] px-3 text-left text-body-m hover:bg-surface', danger && 'text-danger')}
    >
      {icon}
      {label}
    </button>
  )
  return (
    <Sheet open onClose={onClose} size="sm">
      <div className="space-y-3 pt-1">
        {caps?.canReact && detail.room.kind !== 'official' && (
          <div className="flex justify-between rounded-full bg-surface p-1.5" role="group" aria-label="リアクション">
            {REACTIONS.map((r) => (
              <button
                key={r.kind}
                aria-label={r.label}
                onClick={() => run(() => api.chat.react(message.id, r.kind))}
                className="flex size-11 items-center justify-center rounded-full text-[24px] transition-transform hover:scale-110 active:scale-95"
              >
                {r.emoji}
              </button>
            ))}
          </div>
        )}
        <div className="rounded-[12px] bg-surface p-3 text-body-m text-fg2 line-clamp-3">{message.body || (message.kind === 'image' ? '写真' : '作品')}</div>
        <div>
          {detail.canSend && item(<Reply className="size-5" />, '返信', () => onReply(message))}
          {message.body && item(<Copy className="size-5" />, 'コピー', () => run(() => navigator.clipboard.writeText(message.body), 'コピーしました'))}
          {detail.room.kind === 'group' &&
            isAdmin &&
            item(<Megaphone className="size-5" />, pinned ? 'アナウンスを解除' : 'アナウンスに設定', () =>
              run(() => api.chat.pinAnnouncement(detail.room.id, message.id, !pinned)),
            )}
          {canUnsend && item(<Undo2 className="size-5" />, '送信取消', () => run(() => api.chat.unsend(message.id)))}
          {item(<Trash2 className="size-5" />, '自分の画面から削除', () => run(() => api.chat.hideForMe(message.id), '削除しました'))}
          {!mine && message.senderId !== OFFICIAL_USER_ID && item(<Flag className="size-5" />, '通報', () => onReport(message), true)}
        </div>
      </div>
    </Sheet>
  )
}

/** 入力欄：左に「＋」、5行まで伸びる。文字があるときだけ送信ボタン。PC は Enter で送信、Shift+Enter で改行 */
function Composer({
  roomId,
  reply,
  onCancelReply,
  onSend,
  enterToSend,
  detail,
}: {
  roomId: string
  reply: Message | null
  onCancelReply: () => void
  onSend: (i: { body: string; kind?: Message['kind']; meta?: Message['meta'] }) => Promise<void>
  enterToSend: boolean
  detail: RoomDetail
}) {
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(draftKey(roomId)) ?? ''
    } catch {
      return ''
    }
  })
  const [plus, setPlus] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [warn, setWarn] = useState<string[] | null>(null)
  const [uploading, setUploading] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const ng = useSync(() => api.app.ngWords())
  const paused = useSync(() => api.app.settings().heavyFeaturesPaused)

  // ZS-CHAT-23 下書き保持
  useEffect(() => {
    try {
      if (text) localStorage.setItem(draftKey(roomId), text)
      else localStorage.removeItem(draftKey(roomId))
    } catch {
      /* noop */
    }
  }, [text, roomId])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 5 * 26 + 20)}px`
  }, [text])
  useEffect(() => {
    const on = (e: Event) => {
      setText((e as CustomEvent<string>).detail)
      ref.current?.focus()
    }
    window.addEventListener('zs:template', on)
    return () => window.removeEventListener('zs:template', on)
  }, [])
  useEffect(() => {
    if (reply) ref.current?.focus()
  }, [reply])

  const submit = async (force = false) => {
    const body = text.trim()
    if (!body) return
    const check = checkNgWords(body, ng)
    if (check.level === 'block') {
      toast({ text: '利用規約に反する表現が含まれているため送信できません', tone: 'error' })
      return
    }
    if (check.level === 'warn' && !force) {
      setWarn(check.hits)
      return
    }
    setWarn(null)
    setText('')
    // @メンション
    const mentions = detail.members.filter((x) => body.includes(`@${x.profile.displayName}`) || body.includes(`@${x.profile.handle}`)).map((x) => x.profile.id)
    await onSend({ body, meta: mentions.length ? { mentions } : undefined })
  }

  const sendImages = async (files: File[]) => {
    if (paused) {
      toast({ text: '現在、画像の送信を一時停止しています', tone: 'error' })
      return
    }
    const list = files.filter((f) => f.type.startsWith('image/')).slice(0, LIMITS.imagesPerSend)
    if (!list.length) return
    setUploading(true)
    try {
      const images = []
      for (const f of list) {
        const up = await api.storage.uploadImage(f, { kind: 'chat' })
        images.push({ url: up.url, thumbUrl: up.thumbUrl, width: up.width, height: up.height })
      }
      await onSend({ body: '', kind: 'image', meta: { images } })
    } catch (e) {
      toast({ text: errorMessage(e), tone: 'error' })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div
      className="shrink-0 border-t border-subtle bg-base pb-[env(safe-area-inset-bottom)]"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void sendImages([...e.dataTransfer.files])
      }}
    >
      {reply && (
        <div className="flex items-center gap-2 border-b border-subtle px-3 py-2 text-caption">
          <Reply className="size-4 text-brand-text" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-bold">{api.app.profileName(reply.senderId)}</span>に返信：{reply.body || '写真'}
          </span>
          <IconButton label="返信をやめる" className="size-8" onClick={onCancelReply}>
            <X className="size-4" />
          </IconButton>
        </div>
      )}
      {warn && (
        <div className="flex items-center gap-2 border-b border-warning/40 bg-warning/10 px-3 py-2 text-caption">
          <AlertCircle className="size-4 text-warning" />
          <span className="flex-1">「{warn.join('」「')}」を含むメッセージは、相手に誤解を与えることがあります。送信しますか？</span>
          <Button size="sm" variant="secondary" onClick={() => setWarn(null)}>
            直す
          </Button>
          <Button size="sm" onClick={() => submit(true)}>
            送信する
          </Button>
        </div>
      )}
      {plus && (
        <div className="grid grid-cols-3 gap-2 border-b border-subtle p-3">
          <button
            className="card flex min-h-16 flex-col items-center justify-center gap-1 text-caption"
            onClick={() => (fileRef.current?.click(), setPlus(false))}
          >
            <ImageIcon className="size-5 text-brand-text" /> 画像
          </button>
          <button className="card flex min-h-16 flex-col items-center justify-center gap-1 text-caption" onClick={() => (setSharing(true), setPlus(false))}>
            <LayoutGrid className="size-5 text-aurora" /> 作品を共有
          </button>
        </div>
      )}
      <div className="flex items-end gap-1 p-2">
        <IconButton label={plus ? '閉じる' : '画像・作品を送る'} onClick={() => setPlus((v) => !v)} aria-expanded={plus}>
          <Plus className={cn('size-6 transition-transform duration-200', plus && 'rotate-45')} strokeWidth={1.75} />
        </IconButton>
        <textarea
          ref={ref}
          value={text}
          rows={1}
          maxLength={LIMITS.messageLength}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files]
            if (files.length) {
              e.preventDefault()
              void sendImages(files)
            }
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
            const isTouch = matchMedia('(pointer: coarse)').matches
            if (isTouch) return
            if (enterToSend ? !e.shiftKey : e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder={uploading ? '画像を送信中…' : 'メッセージを入力'}
          aria-label="メッセージ"
          className="max-h-[150px] min-h-11 flex-1 resize-none rounded-[22px] border border-subtle bg-surface px-4 py-2.5 text-body-l leading-[1.6] focus:border-brand-text focus:outline-none"
        />
        {text.trim() && (
          <button
            onClick={() => submit()}
            aria-label="送信"
            className="bg-brand anim-fade flex size-11 shrink-0 items-center justify-center rounded-full text-white transition-transform active:scale-90"
          >
            <SendHorizonal className="size-5" />
          </button>
        )}
      </div>
      {text.length > LIMITS.messageLength * 0.9 && (
        <p className="px-4 pb-1 text-right text-caption text-fg2 tabular">
          {text.length}/{LIMITS.messageLength}
        </p>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        hidden
        onChange={(e) => {
          void sendImages([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
      <ShareWorkSheet
        open={sharing}
        onClose={() => setSharing(false)}
        onPick={(workId) => (setSharing(false), onSend({ body: '', kind: 'work', meta: { workId } }))}
      />
    </div>
  )
}

function ShareWorkSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (workId: string) => void }) {
  const mine = useLive(() => (open ? api.works.mine() : Promise.resolve([])), [open])
  const liked = useLive(() => (open ? api.works.liked() : Promise.resolve([])), [open])
  const list = [...(mine.data ?? []).filter((w) => w.visibility !== 'draft' && w.status === 'active'), ...(liked.data ?? []).map((x) => x.work)]
  const me = useMe()
  return (
    <Sheet open={open} onClose={onClose} title="作品を共有" size="md">
      <div className="space-y-2">
        {list.length === 0 && <p className="py-6 text-center text-body-m text-fg2">共有できる作品がありません（自分の作品といいねした作品から選べます）</p>}
        {[...new Map(list.map((w) => [w.id, w])).values()].map((w) => (
          <button key={w.id} onClick={() => onPick(w.id)} className="card flex w-full items-center gap-3 p-2 text-left hover:bg-elevated">
            <img src={w.media[0]?.thumbUrl} alt="" className="aspect-[16/10] w-24 rounded-[8px] object-cover" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-m font-bold">{w.title}</span>
              <span className="block text-caption text-fg2">{w.ownerId === me?.id ? '自分の作品' : 'いいねした作品'}</span>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}

/** 公式アカウント：下部にリッチメニュー（2×2）、キーボードに切り替えられる（14.7 / ZS-OFC-05） */
function OfficialComposer({ roomId, onSend, enterToSend }: { roomId: string; onSend: (i: { body: string }) => Promise<void>; enterToSend: boolean }) {
  const [keyboard, setKeyboard] = useState(false)
  const [text, setText] = useState('')
  const navigate = useNavigate()
  if (!keyboard)
    return (
      <div className="shrink-0 border-t border-subtle bg-base pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-2 gap-px bg-[var(--border-subtle)]">
          {[
            { icon: Newspaper, label: 'AIニュース', fn: () => navigate('/news') },
            { icon: HelpCircle, label: 'よくある質問', fn: () => navigate('/settings/help') },
            { icon: MessageCircleQuestion, label: 'お問い合わせ', fn: () => setKeyboard(true) },
            { icon: Bell, label: 'お知らせ一覧', fn: () => navigate('/notifications') },
          ].map((t) => (
            <button key={t.label} onClick={t.fn} className="flex min-h-16 items-center justify-center gap-2 bg-surface text-label hover:bg-elevated">
              <t.icon className="size-5 text-brand-text" strokeWidth={1.75} /> {t.label}
            </button>
          ))}
        </div>
        <button className="flex min-h-10 w-full items-center justify-center gap-1 text-caption text-fg2" onClick={() => setKeyboard(true)}>
          <Keyboard className="size-4" /> キーボードに切り替える
        </button>
      </div>
    )
  const submit = () => {
    if (!text.trim()) return
    void onSend({ body: text.trim() })
    setText('')
  }
  return (
    <div className="shrink-0 border-t border-subtle bg-base p-2 pb-[max(8px,env(safe-area-inset-bottom))]" data-room={roomId}>
      <div className="flex items-end gap-1">
        <IconButton label="メニューに切り替える" onClick={() => setKeyboard(false)}>
          <LayoutGrid className="size-5" />
        </IconButton>
        <textarea
          value={text}
          rows={1}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && !matchMedia('(pointer: coarse)').matches && (enterToSend ? !e.shiftKey : e.shiftKey)) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="運営への質問を入力"
          aria-label="運営への質問"
          className="max-h-[150px] min-h-11 flex-1 resize-none rounded-[22px] border border-subtle bg-surface px-4 py-2.5 text-body-l"
        />
        {text.trim() && (
          <button onClick={submit} aria-label="送信" className="bg-brand flex size-11 shrink-0 items-center justify-center rounded-full text-white">
            <SendHorizonal className="size-5" />
          </button>
        )}
      </div>
    </div>
  )
}

/** ZS-CHAT-26 ルーム内検索 */
function RoomSearch({ open, onClose, roomId, onPick }: { open: boolean; onClose: () => void; roomId: string; onPick: (id: number) => void }) {
  const [q, setQ] = useState('')
  const { data } = useLive(() => (q.trim() ? api.chat.searchInRoom(roomId, q) : Promise.resolve([])), [roomId, q])
  return (
    <Sheet open={open} onClose={onClose} title="ルーム内検索" size="md">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="メッセージを検索"
        aria-label="メッセージを検索"
        className="mb-3 min-h-11 w-full rounded-full border border-subtle bg-surface px-4"
      />
      <ul className="space-y-1">
        {data?.map((m) => (
          <li key={m.id}>
            <button onClick={() => onPick(m.id)} className="flex w-full flex-col items-start rounded-[12px] px-3 py-2 text-left hover:bg-surface">
              <span className="text-caption text-fg2">
                {api.app.profileName(m.senderId)}・{formatDaySeparator(m.createdAt)} {formatTime(m.createdAt)}
              </span>
              <span className="line-clamp-2 text-body-m">{m.body}</span>
            </button>
          </li>
        ))}
        {q && data?.length === 0 && <li className="py-6 text-center text-body-m text-fg2">見つかりませんでした</li>}
      </ul>
    </Sheet>
  )
}

/** 通知許可の前置き（15.3） */
function PushPrompt({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="通知を受け取りますか？"
      size="sm"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={onClose}>
            あとで
          </Button>
          <Button
            block
            onClick={async () => {
              try {
                const sub = await requestPushPermission()
                await api.notifications.savePushSubscription(sub)
                toast({
                  text:
                    typeof Notification !== 'undefined' && Notification.permission === 'granted'
                      ? '通知をオンにしました'
                      : '通知は設定からいつでもオンにできます',
                })
              } catch (e) {
                toast({ text: errorMessage(e), tone: 'error' })
              }
              onClose()
            }}
          >
            通知を受け取る
          </Button>
        </div>
      }
    >
      <p className="text-body-m text-fg2">新しいメッセージや作品への問い合わせを、すぐにお知らせします。通知の種類はあとで設定から変えられます。</p>
    </Sheet>
  )
}
