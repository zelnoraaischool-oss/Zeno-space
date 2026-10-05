import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Bookmark, ThumbsUp, ExternalLink, Share2 } from 'lucide-react'
import { api, errorMessage, type DigestWithItems } from '@/lib/api'
import { useLive } from '@/hooks/useLive'
import { useMe, useRequireLogin } from '@/app/session'
import { PageHeader } from '@/components/layout/AppLayout'
import { Avatar, IconButton, Sheet, Tabs } from '@/components/ui/primitives'
import { EmptyState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { newsArt } from '@/lib/mock/art'
import { formatDateLabel } from '@/lib/format'
import { uuid } from '@/lib/ids'
import { cn } from '@/lib/cn'

type Item = DigestWithItems['items'][number]

/**
 * U-19 AIニュース（ZS-NEWS-06）。日ごとのダイジェストを新しい順に。
 * 記事本文と記事画像は転載しない：見出し、120文字以内の独自要約、出典名、元記事へのリンクのみ。サムネイルはカテゴリ別の自前イラスト。
 */
export default function News() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'bookmarks' ? 'bookmarks' : 'daily'
  const me = useMe()
  const { data } = useLive(() => api.news.digests(), [])
  const marks = useLive(() => (me && tab === 'bookmarks' ? api.news.bookmarks() : Promise.resolve([])), [tab, me?.id])
  return (
    <>
      <PageHeader title="AIニュース">
        {me && (
          <Tabs
            className="px-2"
            value={tab}
            onChange={(t) => setParams(t === 'daily' ? {} : { tab: t })}
            tabs={[
              { value: 'daily', label: '日ごと' },
              { value: 'bookmarks', label: 'ブックマーク' },
            ]}
          />
        )}
      </PageHeader>
      <div className="mx-auto max-w-3xl space-y-8 p-4">
        {tab === 'daily' ? (
          data?.length === 0 ? (
            <EmptyState art="news" title="まだニュースはありません" body="毎朝7:30に届きます" />
          ) : (
            data?.map((d) => (
              <section key={d.digest.id} aria-labelledby={`d-${d.digest.id}`} className="space-y-3">
                <h2 id={`d-${d.digest.id}`} className="text-title-m">
                  {formatDateLabel(`${d.digest.date}T09:00:00+09:00`)}
                  <span className="ml-2 text-caption text-fg2">{d.items.length}本</span>
                </h2>
                <div className="space-y-3">
                  {d.items.map((n) => (
                    <NewsCard key={n.id} n={n} />
                  ))}
                </div>
              </section>
            ))
          )
        ) : marks.data?.length ? (
          <div className="space-y-3">
            {marks.data.map((n) => (
              <NewsCard key={n.id} n={n} />
            ))}
          </div>
        ) : (
          <EmptyState art="news" title="ブックマークはありません" />
        )}
      </div>
    </>
  )
}

/** 記事カード：カテゴリのイラスト、見出し、要約、出典名、「元記事を読む」「役立った」 */
function NewsCard({ n }: { n: Item }) {
  const requireLogin = useRequireLogin()
  const [share, setShare] = useState(false)
  return (
    <article className="card overflow-hidden">
      <div className="flex gap-3 p-3">
        <img src={newsArt(n.category)} alt="" className="h-20 w-28 shrink-0 rounded-[10px] object-cover" />
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-body-m font-bold">{n.titleJa || n.title}</h3>
          {n.summaryJa && <p className="text-body-m text-fg2">{n.summaryJa}</p>}
          <p className="text-caption text-fg2">出典：{n.source?.name}</p>
        </div>
      </div>
      <div className="flex items-center border-t border-subtle px-1">
        <a href={n.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 flex-1 items-center gap-1.5 px-3 text-label text-brand-text">
          元記事を読む <ExternalLink className="size-3.5" />
        </a>
        <button
          className={cn('inline-flex min-h-11 items-center gap-1 px-3 text-label', n.useful ? 'text-aurora' : 'text-fg2')}
          aria-pressed={n.useful}
          onClick={() => requireLogin({ type: 'nav', to: '/news' }, () => void api.news.react(n.id, 'useful'))}
        >
          <ThumbsUp className={cn('size-4', n.useful && 'fill-current')} /> 役立った{n.usefulCount > 0 && <span className="tabular">{n.usefulCount}</span>}
        </button>
        <IconButton
          label={n.bookmarked ? 'ブックマークを外す' : 'ブックマーク'}
          onClick={() => requireLogin({ type: 'nav', to: '/news' }, () => void api.news.react(n.id, 'bookmark'))}
        >
          <Bookmark className={cn('size-5', n.bookmarked && 'fill-current text-aurora')} />
        </IconButton>
        <IconButton label="トークに共有" onClick={() => requireLogin({ type: 'nav', to: '/news' }, () => setShare(true))}>
          <Share2 className="size-5" />
        </IconButton>
      </div>
      <ShareToTalk open={share} onClose={() => setShare(false)} text={`${n.titleJa}\n${n.url}`} />
    </article>
  )
}

function ShareToTalk({ open, onClose, text }: { open: boolean; onClose: () => void; text: string }) {
  const { data } = useLive(() => (open ? api.chat.listRooms('all') : Promise.resolve([])), [open])
  const toast = useToast()
  const navigate = useNavigate()
  return (
    <Sheet open={open} onClose={onClose} title="トークに共有" size="sm">
      <ul className="space-y-1">
        {data
          ?.filter((r) => r.room.kind !== 'official')
          .map((r) => (
            <li key={r.room.id}>
              <button
                className="flex min-h-14 w-full items-center gap-3 rounded-[12px] px-2 text-left hover:bg-surface"
                onClick={async () => {
                  try {
                    await api.chat.send(r.room.id, { body: text, clientId: uuid() })
                    onClose()
                    toast({ text: `${r.title}に共有しました`, action: { label: '開く', onClick: () => navigate(`/talk/${r.room.id}`) } })
                  } catch (e) {
                    toast({ text: errorMessage(e), tone: 'error' })
                  }
                }}
              >
                <Avatar name={r.title} color={r.peer?.avatarColor ?? r.room.iconColor} url={r.peer?.avatarUrl} size={40} />
                <span className="truncate text-body-m">{r.title}</span>
              </button>
            </li>
          ))}
      </ul>
    </Sheet>
  )
}
