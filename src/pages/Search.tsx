import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search as SearchIcon, SlidersHorizontal, X, LayoutGrid, List, Clock, Tag, BookmarkPlus } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { useLive, useSync } from '@/hooks/useLive'
import { useInfinite } from '@/hooks/useInfinite'
import { useDebounced } from '@/hooks/misc'
import { useMe, useRequireLogin } from '@/app/session'
import { PageHeader } from '@/components/layout/AppLayout'
import { Avatar, Button, Chip, IconButton, Segmented, Sheet, Switch, Tabs, TextField } from '@/components/ui/primitives'
import { EmptyState, BlockError } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { WorkCard, WorkCardSkeleton, WorkGrid, WorkListRow, RollingNumber } from '@/components/work/WorkCard'
import { activeFilterCount, paramsFromQuery, PRICE_STEPS, queryFromParams } from '@/lib/query'
import { PRODUCTION_TYPES, WORK_TYPES } from '@/lib/constants'
import { formatNumber, formatPriceRange } from '@/lib/format'
import type { ProductionType, WorkQuery, WorkType } from '@/lib/types'
import { cn } from '@/lib/cn'

type TabKey = 'works' | 'users' | 'tags'

/** U-05 さがす・U-06 絞り込みシート（14.3） */
export default function Search() {
  const [params, setParams] = useSearchParams()
  const query = useMemo(() => queryFromParams(params), [params])
  const tab = (params.get('tab') as TabKey) ?? 'works'
  const view = params.get('view') === 'list' ? 'list' : 'grid'
  const [text, setText] = useState(query.q ?? '')
  const [focused, setFocused] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const me = useMe()

  useEffect(() => {
    if (params.get('focus') === '1') inputRef.current?.focus()
  }, [params])
  useEffect(() => setText(query.q ?? ''), [query.q])

  const update = (next: WorkQuery, extra: Record<string, string> = {}) => {
    const keep: Record<string, string> = {}
    if (tab !== 'works') keep.tab = tab
    if (view === 'list') keep.view = 'list'
    setParams(paramsFromQuery(next, { ...keep, ...extra }), { replace: true })
  }

  const submit = (q: string) => {
    api.works.recordSearch(q)
    update({ ...query, q: q || undefined })
    inputRef.current?.blur()
    setFocused(false)
  }

  const filterCount = activeFilterCount(query)

  return (
    <>
      <PageHeader title="さがす" actions={<span />}>
        <div className="px-4 pb-3 lg:px-8">
          <form
            role="search"
            className="relative"
            onSubmit={(e) => {
              e.preventDefault()
              submit(text)
            }}
          >
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-fg2" strokeWidth={1.75} />
            <input
              ref={inputRef}
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              placeholder="作品・ユーザー・タグを検索"
              aria-label="検索"
              className="min-h-11 w-full rounded-full border border-subtle bg-surface pl-11 pr-10 text-body-l placeholder:text-fg2/70 focus:border-brand-text focus:outline-none"
            />
            {text && (
              <button
                type="button"
                aria-label="入力を消す"
                className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-fg2"
                onClick={() => submit('')}
              >
                <X className="size-4" />
              </button>
            )}
            {focused && <Suggest text={text} onPick={(q) => (setText(q), submit(q))} />}
          </form>
          <Tabs
            className="mt-2"
            value={tab}
            onChange={(t) => {
              const p = new URLSearchParams(params)
              if (t === 'works') p.delete('tab')
              else p.set('tab', t)
              setParams(p, { replace: true })
            }}
            tabs={[
              { value: 'works', label: '作品' },
              { value: 'users', label: 'ユーザー' },
              { value: 'tags', label: 'タグ' },
            ]}
          />
        </div>
        {tab === 'works' && (
          <div className="no-scrollbar flex items-center gap-2 overflow-x-auto px-4 pb-3 lg:px-8">
            <Chip selected={filterCount > 0} onClick={() => setSheet(true)}>
              <SlidersHorizontal className="size-4" /> 絞り込み
              {filterCount > 0 && <span className="rounded-full bg-white/25 px-1.5 tabular">{filterCount}</span>}
            </Chip>
            <Chip selected={!!query.openOnly} onClick={() => update({ ...query, openOnly: !query.openOnly || undefined })}>
              受付中のみ{query.openOnly && <X className="size-3.5" />}
            </Chip>
            {WORK_TYPES.map((t) => {
              const on = query.types?.includes(t.value)
              return (
                <Chip key={t.value} selected={on} onClick={() => update({ ...query, types: toggle(query.types, t.value) })}>
                  {t.short}
                  {on && <X className="size-3.5" />}
                </Chip>
              )
            })}
          </div>
        )}
      </PageHeader>

      {tab === 'works' && (
        <WorkResults
          query={query}
          view={view}
          onView={(v) => {
            const p = new URLSearchParams(params)
            if (v === 'list') p.set('view', 'list')
            else p.delete('view')
            setParams(p, { replace: true })
          }}
          onSort={(sort) => update({ ...query, sort })}
          onRelax={(next) => update(next)}
          onSave={() => setSaveOpen(true)}
          canSave={!!me}
        />
      )}
      {tab === 'users' && <UserResults q={query.q ?? ''} />}
      {tab === 'tags' && <TagResults q={query.q ?? ''} onPick={(t) => update({ tags: [t] }, {})} />}

      <FilterSheet open={sheet} onClose={() => setSheet(false)} query={query} onApply={(q) => update(q)} />
      <SaveSearchSheet open={saveOpen} onClose={() => setSaveOpen(false)} query={query} />
    </>
  )
}

function toggle<T>(list: T[] | undefined, v: T): T[] | undefined {
  const next = list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v]
  return next.length ? next : undefined
}

/** ZS-SRCH-03 サジェスト：入力中にタグ候補と最近の検索を表示 */
function Suggest({ text, onPick }: { text: string; onPick: (q: string) => void }) {
  const history = useSync(() => api.works.searchHistory())
  const tags = useSync(() => api.works.popularTags())
  const t = text.trim().toLowerCase()
  const tagHits = tags.filter((x) => !t || x.toLowerCase().includes(t)).slice(0, 6)
  const histHits = history.filter((x) => !t || x.toLowerCase().includes(t)).slice(0, 5)
  if (!tagHits.length && !histHits.length) return null
  return (
    <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-[16px] border border-subtle bg-elevated shadow-xl" role="listbox">
      {histHits.map((h) => (
        <div key={h} className="flex items-center">
          <button
            type="button"
            role="option"
            aria-selected={false}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(h)}
            className="flex min-h-11 flex-1 items-center gap-3 px-4 text-left text-body-m hover:bg-surface"
          >
            <Clock className="size-4 text-fg2" /> {h}
          </button>
          <IconButton label={`「${h}」を履歴から消す`} onMouseDown={(e) => e.preventDefault()} onClick={() => api.works.removeSearchHistory(h)}>
            <X className="size-4 text-fg2" />
          </IconButton>
        </div>
      ))}
      {tagHits.map((tag) => (
        <button
          key={tag}
          type="button"
          role="option"
          aria-selected={false}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(tag)}
          className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-body-m hover:bg-surface"
        >
          <Tag className="size-4 text-aurora" /> {tag}
        </button>
      ))}
    </div>
  )
}

function WorkResults({
  query,
  view,
  onView,
  onSort,
  onRelax,
  onSave,
  canSave,
}: {
  query: WorkQuery
  view: 'grid' | 'list'
  onView: (v: 'grid' | 'list') => void
  onSort: (s: WorkQuery['sort']) => void
  onRelax: (q: WorkQuery) => void
  onSave: () => void
  canSave: boolean
}) {
  const key = JSON.stringify(query)
  const { items, total, loading, sentinel, hasMore, error, reload } = useInfinite((offset, limit) => api.works.list(query, { offset, limit }), key, 24)
  const relax = useLive(() => (total === 0 ? api.works.relaxSuggestions(query) : Promise.resolve([])), [key, total])
  return (
    <div className="px-4 py-4 lg:px-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-title-m tabular" aria-live="polite">
          {total === null ? '…' : <RollingNumber value={total} format={formatNumber} />}
          <span className="ml-0.5 text-body-m text-fg2">件</span>
        </p>
        <div className="ml-auto flex items-center gap-2">
          {canSave && (
            <IconButton label="この条件を保存" onClick={onSave}>
              <BookmarkPlus className="size-5" strokeWidth={1.75} />
            </IconButton>
          )}
          <label className="sr-only" htmlFor="sort">
            並び替え
          </label>
          <select
            id="sort"
            value={query.sort ?? 'new'}
            onChange={(e) => onSort(e.target.value as WorkQuery['sort'])}
            className="min-h-10 rounded-[10px] border border-subtle bg-surface px-2 text-label"
          >
            <option value="new">新着順</option>
            <option value="popular">人気順（直近7日）</option>
            <option value="likes">いいね数順</option>
            <option value="views">閲覧数順</option>
          </select>
          <Segmented
            label="表示切替"
            size="sm"
            value={view}
            onChange={onView}
            options={[
              { value: 'grid', label: <LayoutGrid className="size-4" aria-label="グリッド" /> },
              { value: 'list', label: <List className="size-4" aria-label="リスト" /> },
            ]}
          />
        </div>
      </div>
      {error ? <BlockError error={error} onRetry={reload} /> : null}
      {total === 0 && !loading ? (
        <EmptyState
          art="search"
          title="条件に合う作品がありません"
          body="条件を外すと作品が見つかるかもしれません"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {(relax.data ?? []).map((s) => (
                <Chip
                  key={s.key}
                  onClick={() => onRelax(s.key === 'priceMin' ? { ...query, priceMin: undefined, priceMax: undefined } : { ...query, [s.key]: undefined })}
                >
                  {s.label} を外す（{s.count}件）
                </Chip>
              ))}
            </div>
          }
        />
      ) : view === 'grid' ? (
        <WorkGrid>
          {items.map(({ work, owner }) => (
            <WorkCard key={work.id} work={work} owner={owner} />
          ))}
          {loading && Array.from({ length: 8 }, (_, i) => <WorkCardSkeleton key={`s${i}`} />)}
        </WorkGrid>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {items.map(({ work, owner }) => (
            <WorkListRow key={work.id} work={work} owner={owner} />
          ))}
        </div>
      )}
      {hasMore && <div ref={sentinel} className="h-1" />}
    </div>
  )
}

/** 絞り込みシート：選択肢ごとに該当件数を表示し、0件は薄く。300ms 待って件数を取り直す */
function FilterSheet({ open, onClose, query, onApply }: { open: boolean; onClose: () => void; query: WorkQuery; onApply: (q: WorkQuery) => void }) {
  const [draft, setDraft] = useState<WorkQuery>(query)
  useEffect(() => {
    if (open) setDraft(query)
  }, [open, query])
  const debounced = useDebounced(draft, 300)
  const count = useLive(() => api.works.count(debounced), [JSON.stringify(debounced)])
  const facets = useLive(() => api.works.facets(debounced), [JSON.stringify(debounced)])
  const cats = useSync(() => api.works.categories())
  const techs = useSync(() => api.works.techs())
  const f = facets.data
  const minIdx = PRICE_STEPS.indexOf(draft.priceMin ?? 0)
  const maxIdx = draft.priceMax == null ? PRICE_STEPS.length - 1 : PRICE_STEPS.indexOf(draft.priceMax)

  const group = (title: string, children: React.ReactNode) => (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-label">{title}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  )

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="絞り込み"
      full
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setDraft({ q: draft.q, sort: draft.sort })}>
            クリア
          </Button>
          <Button
            block
            size="lg"
            onClick={() => {
              onApply(draft)
              onClose()
            }}
          >
            この条件で <span className="tabular">{count.data === undefined ? '…' : formatNumber(count.data)}</span>件を表示
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {group(
          '種類',
          WORK_TYPES.map((t) => (
            <Chip
              key={t.value}
              selected={draft.types?.includes(t.value)}
              count={f?.types[t.value] ?? 0}
              disabled={!f?.types[t.value] && !draft.types?.includes(t.value)}
              onClick={() => setDraft({ ...draft, types: toggle(draft.types, t.value as WorkType) })}
            >
              {t.short}
            </Chip>
          )),
        )}
        {group(
          'カテゴリ（業種）',
          cats.map((c) => (
            <Chip
              key={c.id}
              selected={draft.categoryIds?.includes(c.id)}
              count={f?.categories[c.id] ?? 0}
              disabled={!f?.categories[c.id] && !draft.categoryIds?.includes(c.id)}
              onClick={() => setDraft({ ...draft, categoryIds: toggle(draft.categoryIds, c.id) })}
            >
              {c.name}
            </Chip>
          )),
        )}
        {group(
          '使用技術',
          techs.map((t) => (
            <Chip
              key={t.id}
              selected={draft.techIds?.includes(t.id)}
              count={f?.techs[t.id] ?? 0}
              disabled={!f?.techs[t.id] && !draft.techIds?.includes(t.id)}
              onClick={() => setDraft({ ...draft, techIds: toggle(draft.techIds, t.id) })}
            >
              {t.name}
            </Chip>
          )),
        )}
        {group(
          '制作形態',
          PRODUCTION_TYPES.map((p) => (
            <Chip
              key={p.value}
              selected={draft.productionTypes?.includes(p.value)}
              count={f?.productionTypes[p.value] ?? 0}
              onClick={() => setDraft({ ...draft, productionTypes: toggle(draft.productionTypes, p.value as ProductionType) })}
            >
              {p.label}
            </Chip>
          )),
        )}
        <fieldset className="space-y-3">
          <legend className="text-label">参考価格帯</legend>
          <p className="text-body-m tabular">
            {formatPriceRange(draft.priceMin ?? 0, draft.priceMax ?? null) ?? '指定なし'}
            {draft.priceMax == null && '（上限なし）'}
          </p>
          {/* 2つつまみのスライダー */}
          <div className="relative h-8">
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-elevated" />
            <div
              className="bg-signature absolute top-1/2 h-1 -translate-y-1/2 rounded-full"
              style={{ left: `${(minIdx / (PRICE_STEPS.length - 1)) * 100}%`, right: `${100 - (maxIdx / (PRICE_STEPS.length - 1)) * 100}%` }}
            />
            <input
              type="range"
              aria-label="下限"
              min={0}
              max={PRICE_STEPS.length - 1}
              value={minIdx}
              onChange={(e) => {
                const i = Math.min(Number(e.target.value), maxIdx)
                setDraft({ ...draft, priceMin: i === 0 ? undefined : PRICE_STEPS[i] })
              }}
              className="range-thumb pointer-events-none absolute inset-0 w-full appearance-none bg-transparent"
            />
            <input
              type="range"
              aria-label="上限"
              min={0}
              max={PRICE_STEPS.length - 1}
              value={maxIdx}
              onChange={(e) => {
                const i = Math.max(Number(e.target.value), minIdx)
                setDraft({ ...draft, priceMax: i === PRICE_STEPS.length - 1 ? undefined : PRICE_STEPS[i] })
              }}
              className="range-thumb pointer-events-none absolute inset-0 w-full appearance-none bg-transparent"
            />
          </div>
        </fieldset>
        <Switch
          label="依頼受付中のみ"
          description={f ? `${f.openOnly}件` : undefined}
          checked={!!draft.openOnly}
          onChange={(v) => setDraft({ ...draft, openOnly: v || undefined })}
        />
      </div>
    </Sheet>
  )
}

function SaveSearchSheet({ open, onClose, query }: { open: boolean; onClose: () => void; query: WorkQuery }) {
  const [name, setName] = useState('')
  const [notify, setNotify] = useState(true)
  const toast = useToast()
  const requireLogin = useRequireLogin()
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="この条件を保存"
      size="sm"
      footer={
        <Button
          block
          onClick={() =>
            requireLogin({ type: 'nav', to: '/search' }, async () => {
              try {
                await api.works.saveSearch(name, query, notify)
                toast({ text: '検索条件を保存しました', tone: 'success' })
                onClose()
              } catch (e) {
                toast({ text: errorMessage(e), tone: 'error' })
              }
            })
          }
        >
          保存する
        </Button>
      }
    >
      <div className="space-y-3">
        <TextField label="名前" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：飲食のLP" maxLength={30} />
        <Switch label="新着作品を通知で受け取る" description="1日1回まとめてお知らせします" checked={notify} onChange={setNotify} />
      </div>
    </Sheet>
  )
}

function UserResults({ q }: { q: string }) {
  const { data, loading } = useLive(() => api.users.search(q), [q])
  if (loading && !data) return <div className="p-6 text-center text-fg2">読み込み中…</div>
  if (!data?.length) return <EmptyState art="search" title="ユーザーが見つかりません" body="表示名・ユーザーID・スキルで検索できます" />
  return (
    <ul className="divide-y divide-[var(--border-subtle)] px-4 lg:px-8">
      {data.map((p) => (
        <li key={p.id}>
          <Link to={`/u/${p.handle}`} className="flex min-h-16 items-center gap-3 py-2">
            <Avatar name={p.displayName} color={p.avatarColor} url={p.avatarUrl} size={44} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-m font-bold">{p.displayName}</p>
              <p className="truncate text-caption text-fg2">
                @{p.handle}・{p.skills.slice(0, 3).join('・')}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function TagResults({ q, onPick }: { q: string; onPick: (t: string) => void }) {
  const tags = useSync(() => api.works.popularTags())
  const hits = tags.filter((t) => !q || t.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className={cn('flex flex-wrap gap-2 px-4 py-4 lg:px-8')}>
      {hits.map((t) => (
        <Chip key={t} onClick={() => onPick(t)}>
          #{t}
        </Chip>
      ))}
      {!hits.length && <EmptyState title="タグが見つかりません" />}
    </div>
  )
}
