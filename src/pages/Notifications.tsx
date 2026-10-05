import { useNavigate } from 'react-router-dom'
import { Heart, MessageCircle, AtSign, Inbox, UserPlus, Search, Megaphone, Newspaper, ShieldAlert, Briefcase } from 'lucide-react'
import { api } from '@/lib/api'
import { useLive } from '@/hooks/useLive'
import { PageHeader } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/primitives'
import { EmptyState } from '@/components/ui/states'
import { formatRelative } from '@/lib/format'
import type { NotificationKind } from '@/lib/types'
import { cn } from '@/lib/cn'

const ICONS: Record<NotificationKind, { icon: typeof Heart; cls: string; label: string }> = {
  message: { icon: MessageCircle, cls: 'text-brand-text', label: 'メッセージ' },
  mention: { icon: AtSign, cls: 'text-brand-text', label: 'メンション' },
  request: { icon: Inbox, cls: 'text-brand-text', label: 'リクエスト' },
  friend: { icon: UserPlus, cls: 'text-success', label: '友だち' },
  like: { icon: Heart, cls: 'text-like', label: 'いいね' },
  inquiry: { icon: Briefcase, cls: 'text-aurora', label: '問い合わせ' },
  saved_search: { icon: Search, cls: 'text-aurora', label: '検索条件' },
  broadcast: { icon: Megaphone, cls: 'text-brand-text', label: 'お知らせ' },
  news: { icon: Newspaper, cls: 'text-aurora', label: 'AIニュース' },
  important: { icon: ShieldAlert, cls: 'text-warning', label: '重要' },
}

/** U-18 通知センター：直近90日、種類別アイコン、未読の強調、まとめ通知（ZS-NOTIF-01） */
export default function Notifications() {
  const { data } = useLive(() => api.notifications.list(), [])
  const navigate = useNavigate()
  const unread = data?.filter((n) => !n.readAt).length ?? 0
  return (
    <>
      <PageHeader
        title="通知"
        back
        actions={
          unread ? (
            <Button variant="ghost" size="sm" onClick={() => api.notifications.markAllRead()}>
              すべて既読
            </Button>
          ) : (
            <span />
          )
        }
      />
      <div className="mx-auto max-w-2xl">
        {data?.length === 0 && <EmptyState art="bell" title="通知はまだありません" body="いいねや問い合わせ、公式アカウントのお知らせがここに届きます" />}
        <ul>
          {data?.map((n) => {
            const I = ICONS[n.kind]
            return (
              <li key={n.id}>
                <button
                  onClick={() => {
                    void api.notifications.markRead(n.id)
                    navigate(n.target)
                  }}
                  className={cn('flex w-full items-start gap-3 border-b border-subtle px-4 py-3 text-left hover:bg-surface', !n.readAt && 'bg-brand/5')}
                >
                  <span className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-elevated', I.cls)}>
                    <I.icon className="size-4" strokeWidth={2} aria-label={I.label} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-body-m', !n.readAt ? 'font-bold text-fg' : 'text-fg2')}>{n.text}</span>
                    <span className="text-caption text-fg2">{formatRelative(n.createdAt)}</span>
                  </span>
                  {!n.readAt && <span className="mt-2 size-2 shrink-0 rounded-full bg-brand-text" aria-label="未読" />}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}
