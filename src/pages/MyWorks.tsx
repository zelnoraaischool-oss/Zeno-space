import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Pencil, EyeOff, Eye, Trash2, RotateCcw, BarChart3, Plus } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { useLive } from '@/hooks/useLive'
import { PageHeader, PostTypeSheet } from '@/components/layout/AppLayout'
import { Badge, Button, IconButton, Sheet, Tabs } from '@/components/ui/primitives'
import { EmptyState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { LineChart } from '@/components/charts'
import { formatCount, formatDateTime } from '@/lib/format'
import type { Work } from '@/lib/types'

type Tab = 'public' | 'draft' | 'private' | 'trash'

/** U-09 自分の作品管理：公開中、下書き、非公開のタブ、インサイト */
export default function MyWorks() {
  const { data } = useLive(() => api.works.mine(), [])
  const [tab, setTab] = useState<Tab>('public')
  const [params, setParams] = useSearchParams()
  const insightId = params.get('insight')
  const [post, setPost] = useState(false)
  const toast = useToast()
  const navigate = useNavigate()
  const list = (data ?? []).filter((w) =>
    tab === 'public'
      ? w.status === 'active' && w.visibility === 'public'
      : tab === 'draft'
        ? w.status === 'active' && w.visibility === 'draft'
        : tab === 'private'
          ? (w.status === 'hidden' || w.visibility === 'unlisted') && w.status !== 'trashed'
          : w.status === 'trashed',
  )
  const count = (t: Tab) =>
    (data ?? []).filter((w) =>
      t === 'public'
        ? w.status === 'active' && w.visibility === 'public'
        : t === 'draft'
          ? w.status === 'active' && w.visibility === 'draft'
          : t === 'private'
            ? (w.status === 'hidden' || w.visibility === 'unlisted') && w.status !== 'trashed'
            : w.status === 'trashed',
    ).length

  const act = async (fn: () => Promise<void>, text: string, undo?: () => Promise<void>) => {
    try {
      await fn()
      toast({ text, action: undo ? { label: '元に戻す', onClick: () => void undo() } : undefined })
    } catch (e) {
      toast({ text: errorMessage(e), tone: 'error' })
    }
  }

  return (
    <>
      <PageHeader
        title="自分の作品"
        back="/me"
        actions={
          <IconButton label="作品を投稿" onClick={() => setPost(true)}>
            <Plus className="size-5" />
          </IconButton>
        }
      >
        <Tabs
          className="px-2"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'public', label: `公開中 ${count('public')}` },
            { value: 'draft', label: `下書き ${count('draft')}` },
            { value: 'private', label: `非公開・限定 ${count('private')}` },
            { value: 'trash', label: `ゴミ箱 ${count('trash')}` },
          ]}
        />
      </PageHeader>
      <div className="mx-auto max-w-3xl space-y-2 p-4">
        {tab === 'trash' && <p className="text-caption text-fg2">削除した作品は30日間ゴミ箱に残り、その後に完全に削除されます。</p>}
        {list.length === 0 && (
          <EmptyState
            art="post"
            title={tab === 'draft' ? '下書きはありません' : tab === 'trash' ? 'ゴミ箱は空です' : 'まだ作品がありません'}
            action={tab === 'public' ? <Button onClick={() => setPost(true)}>作品を投稿する</Button> : undefined}
          />
        )}
        {list.map((w) => (
          <div key={w.id} className="card flex items-center gap-3 p-2.5">
            <Link to={w.visibility === 'draft' ? `/post/${w.id}?step=1` : `/works/${w.id}`} className="shrink-0">
              {w.media[0] ? (
                <img src={w.media[0].thumbUrl} alt="" className="aspect-[16/10] w-28 rounded-[8px] object-cover" />
              ) : (
                <div className="aspect-[16/10] w-28 rounded-[8px] bg-elevated" />
              )}
            </Link>
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-m font-bold">{w.title || '無題の作品'}</p>
              <p className="text-caption text-fg2 tabular">
                {w.visibility === 'draft'
                  ? `更新 ${formatDateTime(w.updatedAt)}`
                  : `いいね ${formatCount(w.likeCount)}・閲覧 ${formatCount(w.viewCount)}・問い合わせ ${w.inquiryCount}`}
              </p>
              <div className="mt-1 flex gap-1">
                {w.status === 'hidden' && <Badge tone="warning">運営により非公開</Badge>}
                {w.visibility === 'unlisted' && <Badge>限定公開</Badge>}
              </div>
            </div>
            <div className="flex shrink-0">
              {tab === 'trash' ? (
                <IconButton label="元に戻す" onClick={() => act(() => api.works.restore(w.id), 'ゴミ箱から戻しました')}>
                  <RotateCcw className="size-5" />
                </IconButton>
              ) : (
                <>
                  {w.visibility !== 'draft' && (
                    <IconButton label="インサイト" onClick={() => setParams({ insight: w.id })}>
                      <BarChart3 className="size-5" />
                    </IconButton>
                  )}
                  <IconButton label="編集" onClick={() => navigate(`/post/${w.id}?step=2`)}>
                    <Pencil className="size-5" />
                  </IconButton>
                  {w.visibility === 'public' ? (
                    <IconButton
                      label="非公開にする"
                      onClick={() =>
                        act(
                          () => api.works.setVisibility(w.id, 'unlisted'),
                          '限定公開にしました',
                          () => api.works.setVisibility(w.id, 'public'),
                        )
                      }
                    >
                      <EyeOff className="size-5" />
                    </IconButton>
                  ) : w.visibility === 'unlisted' ? (
                    <IconButton label="公開する" onClick={() => act(() => api.works.setVisibility(w.id, 'public'), '公開しました')}>
                      <Eye className="size-5" />
                    </IconButton>
                  ) : null}
                  <IconButton
                    label="削除"
                    className="text-danger"
                    onClick={() =>
                      act(
                        () => api.works.trash(w.id),
                        'ゴミ箱に移動しました',
                        () => api.works.restore(w.id),
                      )
                    }
                  >
                    <Trash2 className="size-5" />
                  </IconButton>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <InsightSheet work={(data ?? []).find((w) => w.id === insightId) ?? null} onClose={() => setParams({})} />
      <PostTypeSheet open={post} onClose={() => setPost(false)} />
    </>
  )
}

/** ZS-WORK-19 作品インサイト：閲覧数・いいね数・問い合わせ数の推移（3つは尺度が違うため別々のグラフにする） */
function InsightSheet({ work, onClose }: { work: Work | null; onClose: () => void }) {
  const { data } = useLive(() => (work ? api.works.insights(work.id) : Promise.resolve([])), [work?.id])
  const pts = (k: 'views' | 'likes' | 'inquiries') =>
    (data ?? []).map((s) => ({ label: `${Number(s.date.slice(5, 7))}/${Number(s.date.slice(8, 10))}`, value: s[k] }))
  return (
    <Sheet open={!!work} onClose={onClose} title={work ? `インサイト：${work.title}` : ''} size="lg">
      <div className="grid gap-6 pb-2">
        <LineChart title="閲覧数" data={pts('views')} />
        <LineChart title="いいね数" data={pts('likes')} />
        <LineChart title="問い合わせ数" data={pts('inquiries')} />
      </div>
    </Sheet>
  )
}
