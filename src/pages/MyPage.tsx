import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Heart, FolderHeart, History, LayoutGrid, Plus, Trash2, Settings, Bookmark, Bell } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { useLive } from '@/hooks/useLive'
import { useMe } from '@/app/session'
import { PageHeader } from '@/components/layout/AppLayout'
import { Button, IconButton, Sheet, Switch, Tabs, TextField } from '@/components/ui/primitives'
import { EmptyState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { WorkCard, WorkGrid } from '@/components/work/WorkCard'
import { ProfileView } from './Profile'
import { paramsFromQuery } from '@/lib/query'

type Tab = 'profile' | 'likes' | 'collections' | 'history' | 'saved'

/** U-17 マイページ：自分のプロフィール、いいね一覧、コレクション、閲覧履歴 */
export default function MyPage() {
  const me = useMe()
  const [tab, setTab] = useState<Tab>('profile')
  if (!me) return <Navigate to="/login" replace />
  return (
    <>
      <PageHeader
        title="マイページ"
        actions={
          <>
            <Link to="/notifications" className="lg:hidden">
              <IconButton label="通知">
                <Bell className="size-5" />
              </IconButton>
            </Link>
            <Link to="/settings">
              <IconButton label="設定">
                <Settings className="size-5" />
              </IconButton>
            </Link>
          </>
        }
      >
        <Tabs
          className="px-2"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'profile', label: 'プロフィール' },
            { value: 'likes', label: 'いいね' },
            { value: 'collections', label: 'コレクション' },
            { value: 'history', label: '閲覧履歴' },
            { value: 'saved', label: '保存した条件' },
          ]}
        />
      </PageHeader>
      {tab === 'profile' && (
        <>
          <div className="mx-auto flex max-w-5xl gap-2 px-4 pt-4 lg:px-6">
            <Link to="/me/works" className="card flex min-h-12 flex-1 items-center gap-2 px-4 text-body-m">
              <LayoutGrid className="size-5 text-brand-text" /> 自分の作品を管理
            </Link>
            <Link to="/news?tab=bookmarks" className="card flex min-h-12 flex-1 items-center gap-2 px-4 text-body-m">
              <Bookmark className="size-5 text-aurora" /> ブックマーク
            </Link>
          </div>
          <ProfileView profile={me} self />
        </>
      )}
      {tab === 'likes' && <Likes />}
      {tab === 'collections' && <Collections />}
      {tab === 'history' && <HistoryTab />}
      {tab === 'saved' && <Saved />}
    </>
  )
}

/** ZS-WORK-13 いいね一覧（新しい順） */
function Likes() {
  const { data } = useLive(() => api.works.liked(), [])
  const [pick, setPick] = useState<string | null>(null)
  if (data && !data.length)
    return (
      <EmptyState
        title="いいねした作品はまだありません"
        body="気になった作品のハートを押すと、ここに保存されます"
        action={
          <Link to="/search">
            <Button>作品をさがす</Button>
          </Link>
        }
      />
    )
  return (
    <div className="p-4 lg:px-8">
      <WorkGrid>
        {data?.map(({ work, owner }) => (
          <div key={work.id} className="space-y-1">
            <WorkCard work={work} owner={owner} />
            <button className="min-h-9 w-full rounded-[10px] text-caption text-fg2 hover:bg-surface" onClick={() => setPick(work.id)}>
              <FolderHeart className="mr-1 inline size-3.5" />
              コレクションに追加
            </button>
          </div>
        ))}
      </WorkGrid>
      <CollectionPicker workId={pick} onClose={() => setPick(null)} />
    </div>
  )
}

function CollectionPicker({ workId, onClose }: { workId: string | null; onClose: () => void }) {
  const { data } = useLive(() => api.works.collections(), [])
  const [name, setName] = useState('')
  const toast = useToast()
  return (
    <Sheet open={!!workId} onClose={onClose} title="コレクションに追加" size="sm">
      <div className="space-y-2">
        {data?.map((c) => (
          <label key={c.id} className="flex min-h-12 items-center gap-3 rounded-[12px] px-2 hover:bg-surface">
            <input
              type="checkbox"
              className="size-5 accent-[var(--brand-primary)]"
              checked={!!workId && c.workIds.includes(workId)}
              onChange={() => workId && api.works.toggleInCollection(c.id, workId)}
            />
            <span className="text-body-m">{c.name}</span>
            <span className="ml-auto text-caption text-fg2 tabular">{c.workIds.length}件</span>
          </label>
        ))}
        <form
          className="flex gap-2 pt-2"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              const c = await api.works.createCollection(name)
              if (workId) await api.works.toggleInCollection(c.id, workId)
              setName('')
            } catch (err) {
              toast({ text: errorMessage(err), tone: 'error' })
            }
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="新しいコレクション（例：LPの参考）"
            aria-label="コレクション名"
            className="min-h-11 flex-1 rounded-[12px] border border-subtle bg-surface px-3"
          />
          <Button type="submit" variant="secondary" icon={<Plus className="size-4" />}>
            作成
          </Button>
        </form>
      </div>
    </Sheet>
  )
}

/** ZS-WORK-14 コレクション */
function Collections() {
  const { data } = useLive(() => api.works.collections(), [])
  const liked = useLive(() => api.works.liked(), [])
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const toast = useToast()
  const current = data?.find((c) => c.id === open)
  if (current) {
    const items = (liked.data ?? []).filter((x) => current.workIds.includes(x.work.id))
    return (
      <div className="space-y-3 p-4 lg:px-8">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>
            ← コレクション
          </Button>
          <h2 className="flex-1 text-title-m">{current.name}</h2>
          <IconButton
            label="コレクションを削除"
            className="text-danger"
            onClick={async () => {
              await api.works.deleteCollection(current.id)
              setOpen(null)
              toast({ text: 'コレクションを削除しました' })
            }}
          >
            <Trash2 className="size-5" />
          </IconButton>
        </div>
        {items.length ? (
          <WorkGrid>
            {items.map(({ work, owner }) => (
              <WorkCard key={work.id} work={work} owner={owner} />
            ))}
          </WorkGrid>
        ) : (
          <EmptyState title="まだ作品がありません" body="いいね一覧から追加できます" />
        )}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 lg:px-8">
      {data?.map((c) => {
        const thumbs = (liked.data ?? []).filter((x) => c.workIds.includes(x.work.id)).slice(0, 4)
        return (
          <button key={c.id} onClick={() => setOpen(c.id)} className="card overflow-hidden text-left">
            <div className="grid aspect-[16/10] grid-cols-2 gap-0.5 bg-elevated">
              {thumbs.map((t) => (
                <img key={t.work.id} src={t.work.media[0]?.thumbUrl} alt="" className="size-full object-cover" />
              ))}
            </div>
            <div className="p-3">
              <p className="truncate text-body-m font-bold">{c.name}</p>
              <p className="text-caption text-fg2 tabular">{c.workIds.length}件</p>
            </div>
          </button>
        )
      })}
      <button
        onClick={() => setCreating(true)}
        className="flex aspect-[16/12] flex-col items-center justify-center gap-2 rounded-[16px] border-2 border-dashed border-subtle text-fg2"
      >
        <Plus className="size-6" /> 新しいコレクション
      </button>
      <Sheet
        open={creating}
        onClose={() => setCreating(false)}
        title="新しいコレクション"
        size="sm"
        footer={
          <Button
            block
            onClick={async () => {
              try {
                await api.works.createCollection(name)
                setName('')
                setCreating(false)
              } catch (e) {
                toast({ text: errorMessage(e), tone: 'error' })
              }
            }}
          >
            作成する
          </Button>
        }
      >
        <TextField label="名前" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="例：LPの参考" />
      </Sheet>
    </div>
  )
}

/** ZS-WORK-15 閲覧履歴（最大100件） */
function HistoryTab() {
  const { data } = useLive(() => api.works.history(), [])
  const toast = useToast()
  if (data && !data.length) return <EmptyState art="search" title="閲覧履歴はありません" />
  return (
    <div className="space-y-3 p-4 lg:px-8">
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          icon={<History className="size-4" />}
          onClick={async () => {
            await api.works.clearHistory()
            toast({ text: '閲覧履歴を消しました' })
          }}
        >
          履歴を消す
        </Button>
      </div>
      <WorkGrid>
        {data?.map(({ work, owner }) => (
          <WorkCard key={work.id} work={work} owner={owner} />
        ))}
      </WorkGrid>
    </div>
  )
}

/** ZS-WORK-09 保存した検索条件 */
function Saved() {
  const { data } = useLive(() => api.works.savedSearches(), [])
  if (data && !data.length) return <EmptyState art="search" title="保存した検索条件はありません" body="さがす画面の右上から条件を保存できます" />
  return (
    <ul className="mx-auto max-w-2xl space-y-2 p-4">
      {data?.map((s) => (
        <li key={s.id} className="card flex items-center gap-3 p-3">
          <Link to={`/search?${paramsFromQuery(s.query)}`} className="min-w-0 flex-1">
            <p className="truncate text-body-m font-bold">
              <Heart className="mr-1 inline size-4 text-like" />
              {s.name}
            </p>
            <p className="truncate text-caption text-fg2">{paramsFromQuery(s.query).toString() || 'すべての作品'}</p>
          </Link>
          <div className="w-36">
            <Switch label="新着通知" checked={s.notify} onChange={(v) => api.works.updateSavedSearch(s.id, { notify: v })} />
          </div>
          <IconButton label="削除" className="text-danger" onClick={() => api.works.deleteSavedSearch(s.id)}>
            <Trash2 className="size-4" />
          </IconButton>
        </li>
      ))}
    </ul>
  )
}
