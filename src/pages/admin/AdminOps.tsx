import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Play, ArrowUp, ArrowDown, Replace, Check, AlertTriangle, Plus, Trash2, Pencil, Download, RefreshCw, Send, X } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { useLive, useSync } from '@/hooks/useLive'
import { useMe } from '@/app/session'
import { Avatar, Badge, Button, ConfirmDialog, IconButton, Segmented, Select, Sheet, Switch, Tabs, TextArea, TextField } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import { formatDateTime, formatRelative } from '@/lib/format'
import type { AdminRole, AppSettings, Banner, NewsItem, NewsSource, UsageMetric } from '@/lib/types'
import { cn } from '@/lib/cn'
import { ROLE_LABEL, useAdminRole } from './AdminLayout'
import { can } from '@/lib/api/mock/core'
import { USAGE_LIMITS } from '@/lib/api/mock/admin'

function useRun() {
  const toast = useToast()
  return async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) toast({ text: ok, tone: 'success' })
    } catch (e) {
      toast({ text: errorMessage(e), tone: 'error' })
    }
  }
}

// ---------------------------------------------------------------------------
/** A-10 AIニュース管理（14.11）：段階表示、下書きの編集・差し替え・並べ替え、点数の内訳、承認 */
export function NewsAdmin() {
  const { data } = useLive(() => api.admin.newsToday(), [])
  const settings = useSync(() => api.admin.settings().news)
  const run = useRun()
  const [tab, setTab] = useState<'today' | 'sources' | 'schedule' | 'history'>('today')
  const [replaceFor, setReplaceFor] = useState<NewsItem | null>(null)
  if (!data) return <p className="text-fg2">読み込み中…</p>
  const dg = data.digest
  const stages = [
    ['collect', '収集'],
    ['dedupe', '重複除去'],
    ['select', '選定'],
    ['summarize', '要約'],
    ['review', '承認待ち'],
    ['sent', '配信済み'],
  ] as const
  const stageIdx = dg ? stages.findIndex(([k]) => k === dg.stage) : -1
  const ids = data.selected.map((n) => n.id)
  const move = (i: number, d: -1 | 1) => {
    const arr = [...ids]
    const j = i + d
    if (j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    void api.admin.reorderNews(dg!.id, arr)
  }
  return (
    <div className="space-y-4">
      <h1 className="text-title-l">AIニュース管理</h1>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'today', label: '今日の下書き' },
          { value: 'sources', label: '情報源' },
          { value: 'schedule', label: 'スケジュール' },
          { value: 'history', label: '履歴' },
        ]}
      />
      {tab === 'today' && (
        <>
          <ol className="flex flex-wrap gap-2" aria-label="今日の処理の段階">
            {stages.map(([k, l], i) => {
              const failed = dg?.failedStage === k
              const done = stageIdx >= i && !failed
              return (
                <li
                  key={k}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-3 py-1 text-label',
                    failed ? 'border-danger text-danger' : done ? 'border-transparent bg-brand/20 text-brand-text' : 'border-subtle text-fg2',
                  )}
                >
                  {failed ? <AlertTriangle className="size-3.5" /> : done ? <Check className="size-3.5" /> : null}
                  {l}
                </li>
              )
            })}
          </ol>
          {dg?.status === 'skipped' && (
            <p className="text-body-m text-warning">記事が{settings.minCount}本未満のため、今日は配信しません（設定で変更できます）。</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Play className="size-4" />} onClick={() => run(() => api.admin.runNews(), '今日のニュースを収集しました')}>
              {dg ? '収集し直す' : '今すぐ収集する'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => run(() => api.admin.runNews({ failSummaryForDemo: true }), '要約に失敗した場合の表示を確認できます')}
            >
              要約失敗を再現（デモ）
            </Button>
            {dg && (dg.status === 'pending' || dg.status === 'approved') && (
              <Button
                variant="signature"
                icon={<Send className="size-4" />}
                className="ml-auto"
                onClick={() =>
                  run(
                    async () => {
                      const r = await api.admin.approveNews(dg.id)
                      return r
                    },
                    settings.time ? `承認しました（${settings.time} 前なら予約時刻に、過ぎていれば即時に配信）` : '承認しました',
                  )
                }
              >
                承認して配信
              </Button>
            )}
          </div>
          <div className="space-y-3">
            {data.selected.map((n, i) => (
              <NewsDraftCard
                key={n.id}
                n={n}
                rank={i + 1}
                source={data.sources.find((s) => s.id === n.sourceId)}
                editable={dg?.status !== 'sent'}
                onUp={() => move(i, -1)}
                onDown={() => move(i, 1)}
                onReplace={() => setReplaceFor(n)}
                first={i === 0}
                last={i === data.selected.length - 1}
              />
            ))}
          </div>
          <Sheet open={!!replaceFor} onClose={() => setReplaceFor(null)} title="候補から差し替え" size="md">
            <ul className="space-y-2">
              {data.candidates.map((c) => (
                <li key={c.id}>
                  <button
                    className="card w-full p-3 text-left hover:bg-elevated"
                    onClick={() => (void api.admin.replaceNews(replaceFor!.id, c.id), setReplaceFor(null))}
                  >
                    <p className="text-body-m font-bold">{c.titleJa}</p>
                    <p className="text-caption text-fg2">
                      {data.sources.find((s) => s.id === c.sourceId)?.name}・点数 {c.score}
                    </p>
                  </button>
                </li>
              ))}
              {data.candidates.length === 0 && <p className="text-fg2">候補がありません</p>}
            </ul>
          </Sheet>
        </>
      )}
      {tab === 'sources' && <Sources sources={data.sources} reactions={data.reactions} />}
      {tab === 'schedule' && <NewsSchedule />}
      {tab === 'history' && (
        <ul className="card divide-y divide-[var(--border-subtle)]">
          {data.history.map((h) => (
            <li key={h.id} className="flex items-center justify-between p-3 text-body-m">
              <span className="tabular">{h.date}</span>
              <Badge tone={h.status === 'sent' ? 'success' : 'muted'}>
                {{ collecting: '収集中', pending: '承認待ち', approved: '承認済み', sent: '配信済み', skipped: '配信なし', failed: '失敗' }[h.status]}
              </Badge>
              <span className="text-caption text-fg2">{h.approvedBy ? `承認：${api.app.profileName(h.approvedBy)}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NewsDraftCard({
  n,
  rank,
  source,
  editable,
  onUp,
  onDown,
  onReplace,
  first,
  last,
}: {
  n: NewsItem
  rank: number
  source?: NewsSource
  editable: boolean
  onUp: () => void
  onDown: () => void
  onReplace: () => void
  first: boolean
  last: boolean
}) {
  const [title, setTitle] = useState(n.titleJa)
  const [summary, setSummary] = useState(n.summaryJa ?? '')
  const run = useRun()
  useEffect(() => {
    setTitle(n.titleJa)
    setSummary(n.summaryJa ?? '')
  }, [n.titleJa, n.summaryJa])
  const dirty = title !== n.titleJa || summary !== (n.summaryJa ?? '')
  return (
    <div className="card space-y-2 p-4">
      <div className="flex items-start gap-2">
        <span className="text-signature text-title-m tabular">{rank}</span>
        <div className="min-w-0 flex-1 space-y-2">
          <TextField label="見出し（日本語）" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!editable} />
          <TextArea
            label="要約（120文字以内）"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={120}
            counter={{ value: summary.length, max: 120 }}
            rows={3}
            disabled={!editable}
            hint={n.summaryJa ? undefined : '要約に失敗したため、見出しと出典だけで配信します'}
          />
          <p className="text-caption text-fg2">
            出典：{source?.name}・原題：{n.title}
          </p>
          {/* 選ばれた理由が分かるよう点数の内訳を出す */}
          <p className="text-caption tabular">
            点数 <span className="font-bold">{n.score}</span>（情報源の重み {n.scoreDetail.weight}・キーワード {n.scoreDetail.keyword}・新しさ{' '}
            {n.scoreDetail.freshness}）
          </p>
        </div>
        {editable && (
          <div className="flex flex-col">
            <IconButton label="上へ" className="size-9" disabled={first} onClick={onUp}>
              <ArrowUp className="size-4" />
            </IconButton>
            <IconButton label="下へ" className="size-9" disabled={last} onClick={onDown}>
              <ArrowDown className="size-4" />
            </IconButton>
            <IconButton label="候補と差し替え" className="size-9" onClick={onReplace}>
              <Replace className="size-4" />
            </IconButton>
          </div>
        )}
      </div>
      {dirty && (
        <Button size="sm" onClick={() => run(() => api.admin.updateNewsItem(n.id, { titleJa: title, summaryJa: summary }), '保存しました')}>
          保存
        </Button>
      )}
    </div>
  )
}

function Sources({ sources, reactions }: { sources: NewsSource[]; reactions: { source: NewsSource; useful: number }[] }) {
  const [edit, setEdit] = useState<Partial<NewsSource> | null>(null)
  const run = useRun()
  return (
    <div className="space-y-3">
      <Button
        icon={<Plus className="size-4" />}
        onClick={() => setEdit({ name: '', feedUrl: '', lang: 'en', weight: 0.8, enabled: true, termsCheckedAt: null })}
      >
        情報源を追加
      </Button>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-body-m">
          <thead className="text-caption text-fg2">
            <tr className="border-b border-subtle">
              <th className="p-3">名前</th>
              <th className="p-3">言語</th>
              <th className="p-3">重み</th>
              <th className="p-3">最終成功</th>
              <th className="p-3">失敗</th>
              <th className="p-3">役立った</th>
              <th className="p-3">有効</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} className="border-b border-subtle last:border-0">
                <td className="p-3">
                  <span className="block font-bold">{s.name}</span>
                  <span className="block max-w-xs truncate text-caption text-fg2">{s.feedUrl}</span>
                </td>
                <td className="p-3">{s.lang === 'ja' ? '日本語' : '英語'}</td>
                <td className="p-3 tabular">{s.weight}</td>
                <td className="p-3 text-caption">{s.lastSuccessAt ? formatRelative(s.lastSuccessAt) : '—'}</td>
                <td className="p-3">{s.failureCount ? <Badge tone="danger">{s.failureCount}回</Badge> : '0'}</td>
                <td className="p-3 tabular">{reactions.find((r) => r.source.id === s.id)?.useful ?? 0}</td>
                <td className="p-3">{s.enabled ? <Badge tone="success">有効</Badge> : <Badge>無効</Badge>}</td>
                <td className="p-3">
                  <IconButton label="編集" onClick={() => setEdit(s)}>
                    <Pencil className="size-4" />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Sheet
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? '情報源を編集' : '情報源を追加'}
        footer={
          <div className="flex gap-2">
            {edit?.id && (
              <Button
                variant="ghost"
                className="text-danger"
                onClick={() => run(async () => (await api.admin.deleteSource(edit.id!), setEdit(null)), '削除しました')}
              >
                削除
              </Button>
            )}
            <Button block onClick={() => run(async () => (await api.admin.saveSource(edit as NewsSource), setEdit(null)), '保存しました')}>
              保存
            </Button>
          </div>
        }
      >
        {edit && (
          <div className="space-y-3">
            <TextField label="名前" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <TextField label="フィードURL（RSS / Atom）" value={edit.feedUrl ?? ''} onChange={(e) => setEdit({ ...edit, feedUrl: e.target.value })} />
            <Segmented
              label="言語"
              value={edit.lang ?? 'en'}
              onChange={(v) => setEdit({ ...edit, lang: v })}
              options={[
                { value: 'ja', label: '日本語' },
                { value: 'en', label: '英語' },
              ]}
            />
            <TextField
              type="number"
              step={0.1}
              min={0}
              max={1}
              label="重み（0〜1）"
              value={edit.weight ?? 0.8}
              onChange={(e) => setEdit({ ...edit, weight: Number(e.target.value) })}
            />
            <Switch label="有効" checked={!!edit.enabled} onChange={(v) => setEdit({ ...edit, enabled: v })} />
            {/* 19.6 情報源は利用規約を確認してから登録し、確認日を記録する */}
            <Switch
              label="利用規約とフィードの利用条件を確認した"
              description={edit.termsCheckedAt ? `確認日：${formatDateTime(edit.termsCheckedAt)}` : '確認日を記録します'}
              checked={!!edit.termsCheckedAt}
              onChange={(v) => setEdit({ ...edit, termsCheckedAt: v ? new Date().toISOString() : null })}
            />
          </div>
        )}
      </Sheet>
    </div>
  )
}

function NewsSchedule() {
  const s = useSync(() => api.admin.settings().news)
  const run = useRun()
  const [inc, setInc] = useState(s.includeKeywords.join('、'))
  const [exc, setExc] = useState(s.excludeKeywords.join('、'))
  const save = (patch: Partial<AppSettings['news']>) => run(() => api.admin.updateSettings({ news: { ...s, ...patch } }), '保存しました')
  return (
    <div className="card max-w-xl space-y-4 p-5">
      <TextField type="time" label="配信時刻（JST）" value={s.time} onChange={(e) => save({ time: e.target.value })} hint="30分前に収集を始めます" />
      <div>
        <p className="mb-2 text-label">曜日</p>
        <Segmented
          label="曜日"
          value={s.days}
          onChange={(v) => save({ days: v })}
          options={[
            { value: 'daily', label: '毎日' },
            { value: 'weekdays', label: '平日のみ' },
          ]}
        />
      </div>
      <div>
        <p className="mb-2 text-label">配信モード</p>
        <Segmented
          label="配信モード"
          value={s.mode}
          onChange={(v) => save({ mode: v })}
          options={[
            { value: 'approval', label: '承認後に配信' },
            { value: 'auto', label: '自動配信' },
          ]}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField type="number" min={3} max={10} label="本数（3〜10）" value={s.count} onChange={(e) => save({ count: Number(e.target.value) })} />
        <TextField type="number" min={0} max={10} label="配信する最小本数" value={s.minCount} onChange={(e) => save({ minCount: Number(e.target.value) })} />
      </div>
      <TextField
        label="含めるキーワード（、区切り）"
        value={inc}
        onChange={(e) => setInc(e.target.value)}
        onBlur={() =>
          save({
            includeKeywords: inc
              .split(/[、,]/)
              .map((x) => x.trim())
              .filter(Boolean),
          })
        }
      />
      <TextField
        label="除くキーワード（、区切り）"
        value={exc}
        onChange={(e) => setExc(e.target.value)}
        onBlur={() =>
          save({
            excludeKeywords: exc
              .split(/[、,]/)
              .map((x) => x.trim())
              .filter(Boolean),
          })
        }
      />
      <div>
        <p className="mb-2 text-label">要約に使うAI</p>
        <Segmented
          label="要約に使うAI"
          value={s.provider}
          onChange={(v) => save({ provider: v })}
          options={[
            { value: 'workers-ai', label: 'Workers AI' },
            { value: 'gemini', label: 'Gemini API' },
          ]}
        />
        <p className="mt-1 text-caption text-fg2">
          Gemini API の無料枠は18歳未満が利用する可能性のあるサービスでの利用を禁じています。対象年齢（Q-02）が決まるまでは Workers AI を使います。
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
/** A-11 サポート受信箱：会話一覧、担当者、定型文（ZS-ADM-20） */
export function SupportInbox() {
  const { data } = useLive(() => api.admin.supportThreads(), [])
  const [sel, setSel] = useState<string | null>(null)
  const current = data?.find((t) => t.thread.roomId === sel) ?? data?.[0]
  const msgs = useLive(() => (current ? api.admin.supportMessages(current.thread.roomId) : Promise.resolve([])), [current?.thread.roomId])
  const templates = useSync(() => api.admin.supportTemplates())
  const me = useMe()!
  const [text, setText] = useState('')
  const [sign, setSign] = useState(false)
  const run = useRun()
  return (
    <div className="space-y-4">
      <h1 className="text-title-l">サポート受信箱</h1>
      {data?.length === 0 ? (
        <p className="text-fg2">公式アカウント宛てのメッセージはまだありません。ユーザー側の公式トークで「お問い合わせ」から送ると届きます。</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <ul className="card divide-y divide-[var(--border-subtle)] overflow-hidden">
            {data?.map((t) => (
              <li key={t.thread.roomId}>
                <button
                  onClick={() => setSel(t.thread.roomId)}
                  className={cn('flex w-full items-center gap-3 p-3 text-left hover:bg-surface', current?.thread.roomId === t.thread.roomId && 'bg-surface')}
                >
                  <Avatar name={t.user.displayName} color={t.user.avatarColor} url={t.user.avatarUrl} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-m font-bold">{t.user.displayName}</span>
                    <span className="block truncate text-caption text-fg2">{t.last?.body}</span>
                  </span>
                  <Badge tone={t.thread.status === 'open' ? 'warning' : t.thread.status === 'pending' ? 'aurora' : 'muted'}>
                    {{ open: '未対応', pending: '返信済み', closed: '完了' }[t.thread.status]}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
          {current && (
            <section className="card flex min-h-[480px] flex-col">
              <div className="flex flex-wrap items-center gap-2 border-b border-subtle p-3">
                <Link to={`/admin/users/${current.user.id}`} className="text-body-m font-bold text-brand-text">
                  {current.user.displayName}
                </Link>
                <span className="text-caption text-fg2">担当：{current.thread.assigneeId ? api.app.profileName(current.thread.assigneeId) : '未割り当て'}</span>
                <span className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => run(() => api.admin.updateSupport(current.thread.roomId, { assigneeId: me.id }))}>
                  自分が担当
                </Button>
                <Select
                  value={current.thread.status}
                  onChange={(v) => run(() => api.admin.updateSupport(current.thread.roomId, { status: v as 'open' }))}
                  options={[
                    { value: 'open', label: '未対応' },
                    { value: 'pending', label: '返信済み' },
                    { value: 'closed', label: '完了' },
                  ]}
                />
              </div>
              <ol className="flex-1 space-y-2 overflow-y-auto p-3">
                {msgs.data?.map((m) => (
                  <li key={m.id} className={cn('flex', m.senderId === current.user.id ? 'justify-start' : 'justify-end')}>
                    <span
                      className={cn(
                        'max-w-[75%] whitespace-pre-wrap rounded-[16px] px-3 py-2 text-body-m',
                        m.senderId === current.user.id ? 'bg-bubble-other' : 'bg-brand text-white',
                      )}
                    >
                      {m.body}
                      <span className="mt-0.5 block text-[11px] opacity-70">{formatDateTime(m.createdAt)}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="space-y-2 border-t border-subtle p-3">
                <div className="flex flex-wrap gap-1.5">
                  {templates.map((t) => (
                    <button key={t.id} onClick={() => setText(t.body)} className="min-h-8 rounded-full border border-subtle px-3 text-caption">
                      {t.title}
                    </button>
                  ))}
                </div>
                <TextArea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="返信" placeholder="「運営チーム」として返信します" />
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-caption">
                    <input type="checkbox" checked={sign} onChange={(e) => setSign(e.target.checked)} className="size-4" /> 担当者名を添える
                  </label>
                  <span className="flex-1" />
                  <Button
                    disabled={!text.trim()}
                    onClick={() =>
                      run(
                        async () => (await api.admin.supportReply(current.thread.roomId, text, sign ? me.displayName : undefined), setText('')),
                        '返信しました',
                      )
                    }
                  >
                    返信する
                  </Button>
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
/** A-12 お知らせ・バナー：掲出期間、表示先、プレビュー（ZS-BC-10） */
export function BannersAdmin() {
  const { data } = useLive(() => api.admin.banners(), [])
  const [edit, setEdit] = useState<(Omit<Banner, 'id'> & { id?: string }) | null>(null)
  const run = useRun()
  const now = new Date()
  const toLocal = (iso: string) => {
    const d = new Date(iso)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-title-l">お知らせ・バナー</h1>
        <Button
          icon={<Plus className="size-4" />}
          onClick={() =>
            setEdit({
              title: '',
              body: '',
              link: null,
              startsAt: now.toISOString(),
              endsAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
              target: 'home',
            })
          }
        >
          バナーを作成
        </Button>
      </div>
      <div className="space-y-2">
        {data?.map((b) => {
          const live = new Date(b.startsAt) <= now && new Date(b.endsAt) > now
          return (
            <div key={b.id} className="card flex items-center gap-3 p-4">
              <Badge tone={live ? 'success' : 'muted'}>{live ? '掲出中' : new Date(b.startsAt) > now ? '予定' : '終了'}</Badge>
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{b.title}</span>
                <span className="text-caption text-fg2">
                  {formatDateTime(b.startsAt)} 〜 {formatDateTime(b.endsAt)}
                </span>
              </span>
              <IconButton label="編集" onClick={() => setEdit(b)}>
                <Pencil className="size-4" />
              </IconButton>
              <IconButton label="削除" className="text-danger" onClick={() => run(() => api.admin.deleteBanner(b.id), '削除しました')}>
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          )
        })}
      </div>
      <Sheet
        open={!!edit}
        onClose={() => setEdit(null)}
        title="バナー"
        footer={
          <Button block onClick={() => run(async () => (await api.admin.saveBanner(edit!), setEdit(null)), '保存しました')}>
            保存
          </Button>
        }
      >
        {edit && (
          <div className="space-y-3">
            <TextField label="タイトル" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            <TextArea label="本文" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} rows={2} />
            <TextField label="リンク（任意）" value={edit.link ?? ''} onChange={(e) => setEdit({ ...edit, link: e.target.value || null })} />
            <div className="grid grid-cols-2 gap-2">
              <TextField
                type="datetime-local"
                label="掲出開始"
                value={toLocal(edit.startsAt)}
                onChange={(e) => setEdit({ ...edit, startsAt: new Date(e.target.value).toISOString() })}
              />
              <TextField
                type="datetime-local"
                label="掲出終了"
                value={toLocal(edit.endsAt)}
                onChange={(e) => setEdit({ ...edit, endsAt: new Date(e.target.value).toISOString() })}
              />
            </div>
            <div className="card flex items-start gap-3 border-aurora/30 p-3">
              <span className="mt-1 size-2 rounded-full bg-aurora" />
              <span>
                <span className="block text-body-m font-bold">{edit.title || 'タイトル'}</span>
                <span className="text-caption text-fg2">{edit.body || '本文'}</span>
              </span>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}

// ---------------------------------------------------------------------------
/** A-13 マスタ管理：カテゴリ、使用技術、タグの統合、NGワード、テンプレート（ZS-ADM-21） */
export function Masters() {
  const [tab, setTab] = useState<'categories' | 'techs' | 'tags' | 'ng' | 'templates'>('categories')
  const run = useRun()
  const cats = useSync(() => api.works.categories())
  const techs = useSync(() => api.works.techs())
  const ng = useSync(() => api.app.ngWords())
  const tags = useSync(() => api.works.popularTags())
  const templates = useSync(() => api.admin.supportTemplates())
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [merge, setMerge] = useState({ from: '', to: '' })
  const [word, setWord] = useState('')
  const [sev, setSev] = useState<'warn' | 'block'>('warn')
  const [tpl, setTpl] = useState({ title: '', body: '' })
  const list = tab === 'categories' ? cats : techs
  return (
    <div className="space-y-4">
      <h1 className="text-title-l">マスタ管理</h1>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'categories', label: 'カテゴリ' },
          { value: 'techs', label: '使用技術' },
          { value: 'tags', label: 'タグの統合' },
          { value: 'ng', label: 'NGワード' },
          { value: 'templates', label: '定型文' },
        ]}
      />
      {(tab === 'categories' || tab === 'techs') && (
        <div className="max-w-xl space-y-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => (e.preventDefault(), run(async () => (await api.admin.saveMaster(tab, { name }), setName('')), '追加しました'))}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="新しい項目"
              aria-label="新しい項目"
              className="min-h-11 flex-1 rounded-[12px] border border-subtle bg-surface px-3"
            />
            <Button type="submit" icon={<Plus className="size-4" />}>
              追加
            </Button>
          </form>
          <ul className="card divide-y divide-[var(--border-subtle)]">
            {list.map((m, i) => (
              <li key={m.id} className="flex items-center gap-2 px-3 py-1.5">
                {editing?.id === m.id ? (
                  <form
                    className="flex flex-1 gap-2"
                    onSubmit={(e) => (e.preventDefault(), run(async () => (await api.admin.saveMaster(tab, editing), setEditing(null))))}
                  >
                    <input
                      autoFocus
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      aria-label="名前"
                      className="min-h-10 flex-1 rounded-[10px] border border-subtle bg-surface px-2"
                    />
                    <Button size="sm" type="submit">
                      保存
                    </Button>
                  </form>
                ) : (
                  <span className="flex-1 text-body-m">{m.name}</span>
                )}
                <IconButton label="上へ" className="size-9" disabled={i === 0} onClick={() => run(() => api.admin.moveMaster(tab, m.id, -1))}>
                  <ArrowUp className="size-4" />
                </IconButton>
                <IconButton label="下へ" className="size-9" disabled={i === list.length - 1} onClick={() => run(() => api.admin.moveMaster(tab, m.id, 1))}>
                  <ArrowDown className="size-4" />
                </IconButton>
                <IconButton label="名前を変更" className="size-9" onClick={() => setEditing({ id: m.id, name: m.name })}>
                  <Pencil className="size-4" />
                </IconButton>
                <IconButton label="削除" className="size-9 text-danger" onClick={() => run(() => api.admin.deleteMaster(tab, m.id), '削除しました')}>
                  <Trash2 className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tab === 'tags' && (
        <div className="max-w-xl space-y-3">
          <p className="text-body-m text-fg2">表記の違うタグを1つにまとめます（例：「LP」「ランディングページ」→「LP」）。</p>
          <div className="grid grid-cols-2 gap-2">
            <Select
              label="まとめるタグ"
              value={merge.from}
              onChange={(v) => setMerge({ ...merge, from: v })}
              options={[{ value: '', label: '選択' }, ...tags.map((t) => ({ value: t, label: t }))]}
            />
            <TextField label="まとめ先" value={merge.to} onChange={(e) => setMerge({ ...merge, to: e.target.value })} />
          </div>
          <Button
            disabled={!merge.from || !merge.to}
            onClick={() => run(async () => (await api.admin.mergeTags(merge.from, merge.to), setMerge({ from: '', to: '' })), 'タグを統合しました')}
          >
            統合する
          </Button>
        </div>
      )}
      {tab === 'ng' && (
        <div className="max-w-xl space-y-3">
          <p className="text-body-m text-fg2">
            NGワードは端末の中で照合します（サーバーでは本文を解析しません）。「警告」は送信前に確認、「送信停止」は送信を止めます。
          </p>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => (e.preventDefault(), run(async () => (await api.admin.saveNgWord(word, sev), setWord('')), '追加しました'))}
          >
            <input
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder="NGワード"
              aria-label="NGワード"
              className="min-h-11 flex-1 rounded-[12px] border border-subtle bg-surface px-3"
            />
            <Segmented
              label="重さ"
              value={sev}
              onChange={setSev}
              options={[
                { value: 'warn', label: '警告' },
                { value: 'block', label: '送信停止' },
              ]}
            />
            <Button type="submit">追加</Button>
          </form>
          <ul className="card divide-y divide-[var(--border-subtle)]">
            {ng.map((w) => (
              <li key={w.id} className="flex items-center gap-3 px-3 py-2">
                <span className="flex-1 text-body-m">{w.word}</span>
                <Badge tone={w.severity === 'block' ? 'danger' : 'warning'}>{w.severity === 'block' ? '送信停止' : '警告'}</Badge>
                <IconButton label="削除" className="text-danger" onClick={() => run(() => api.admin.deleteNgWord(w.id))}>
                  <X className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tab === 'templates' && (
        <div className="max-w-xl space-y-3">
          {templates.map((t) => (
            <div key={t.id} className="card p-3">
              <p className="text-body-m font-bold">{t.title}</p>
              <p className="text-caption text-fg2">{t.body}</p>
            </div>
          ))}
          <div className="card space-y-2 p-3">
            <TextField label="タイトル" value={tpl.title} onChange={(e) => setTpl({ ...tpl, title: e.target.value })} />
            <TextArea label="本文" value={tpl.body} onChange={(e) => setTpl({ ...tpl, body: e.target.value })} rows={3} />
            <Button
              disabled={!tpl.title || !tpl.body}
              onClick={() => run(async () => (await api.admin.saveTemplate(tpl), setTpl({ title: '', body: '' })), '追加しました')}
            >
              定型文を追加
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
/** A-14 運営メンバー：ロール、二要素認証の状態（ZS-ADM-26 はオーナーのみ操作） */
export function Members() {
  const { data } = useLive(() => api.admin.members(), [])
  const role = useAdminRole()
  const run = useRun()
  const [handle, setHandle] = useState('')
  const [newRole, setNewRole] = useState<AdminRole>('moderator')
  const isOwner = can(role, 'members')
  return (
    <div className="space-y-4">
      <h1 className="text-title-l">運営メンバー</h1>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-body-m">
          <thead className="text-caption text-fg2">
            <tr className="border-b border-subtle">
              <th className="p-3">メンバー</th>
              <th className="p-3">ロール</th>
              <th className="p-3">二要素認証</th>
              {isOwner && <th className="p-3" />}
            </tr>
          </thead>
          <tbody>
            {data?.map(({ member, profile }) => (
              <tr key={member.userId} className="border-b border-subtle last:border-0">
                <td className="p-3">
                  <span className="flex items-center gap-2">
                    <Avatar name={profile.displayName} color={profile.avatarColor} url={profile.avatarUrl} size={32} />
                    {profile.displayName} <span className="text-caption text-fg2">@{profile.handle}</span>
                  </span>
                </td>
                <td className="p-3">
                  {isOwner && member.role !== 'owner' ? (
                    <select
                      value={member.role}
                      onChange={(e) => run(() => api.admin.setMemberRole(profile.handle, e.target.value as AdminRole), 'ロールを変更しました')}
                      aria-label="ロール"
                      className="min-h-10 rounded-[10px] border border-subtle bg-surface px-2"
                    >
                      {(Object.keys(ROLE_LABEL) as AdminRole[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge tone="brand">{ROLE_LABEL[member.role]}</Badge>
                  )}
                </td>
                <td className="p-3">{member.totpEnrolled ? <Badge tone="success">設定済み</Badge> : <Badge tone="warning">未設定</Badge>}</td>
                {isOwner && (
                  <td className="p-3 text-right">
                    {member.role !== 'owner' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger"
                        onClick={() => run(() => api.admin.setMemberRole(profile.handle, null), 'ロールを外しました')}
                      >
                        ロールを外す
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isOwner && (
        <form
          className="card flex max-w-xl flex-wrap items-end gap-2 p-4"
          onSubmit={(e) => (e.preventDefault(), run(async () => (await api.admin.setMemberRole(handle, newRole), setHandle('')), 'ロールを付与しました'))}
        >
          <div className="flex-1">
            <TextField label="ユーザーID" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle" />
          </div>
          <Select
            label="ロール"
            value={newRole}
            onChange={(v) => setNewRole(v as AdminRole)}
            options={(Object.keys(ROLE_LABEL) as AdminRole[]).filter((r) => r !== 'owner').map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          />
          <Button type="submit">付与する</Button>
        </form>
      )}
      <p className="text-caption text-fg2">
        運営メンバーも一般アカウントを1つ持ち、そのアカウントにロールを付与します。コンソールへのログインには二要素認証（TOTP）が必須です。
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
/** A-15 監査ログ：操作者、対象、日時、変更前後、CSV 出力（追記のみ・1年保持） */
export function Audit() {
  const [q, setQ] = useState('')
  const { data } = useLive(() => api.admin.auditLogs(q), [q])
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-title-l">監査ログ</h1>
        <Button
          variant="secondary"
          icon={<Download className="size-4" />}
          onClick={() => {
            const blob = new Blob(['﻿' + api.admin.auditCsv()], { type: 'text/csv' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`
            a.click()
          }}
        >
          CSV 出力
        </Button>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="操作、対象、操作者で絞り込む"
        aria-label="絞り込み"
        className="min-h-11 w-full max-w-md rounded-[12px] border border-subtle bg-surface px-3"
      />
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-caption">
          <thead className="text-fg2">
            <tr className="border-b border-subtle">
              <th className="p-3">日時（JST）</th>
              <th className="p-3">操作者</th>
              <th className="p-3">操作</th>
              <th className="p-3">対象</th>
              <th className="p-3">変更前</th>
              <th className="p-3">変更後</th>
            </tr>
          </thead>
          <tbody>
            {data?.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-fg2">
                  まだ記録はありません
                </td>
              </tr>
            )}
            {data?.map(({ log: l, actor }) => (
              <tr key={l.id} className="border-b border-subtle align-top last:border-0">
                <td className="p-3 tabular">{formatDateTime(l.createdAt)}</td>
                <td className="p-3">{actor?.displayName ?? 'システム'}</td>
                <td className="p-3 font-bold">{l.action}</td>
                <td className="p-3">
                  {l.targetType}:{l.targetId.slice(0, 12)}
                </td>
                <td className="max-w-48 truncate p-3 text-fg2">{l.before ? JSON.stringify(l.before) : '—'}</td>
                <td className="max-w-64 truncate p-3 text-fg2">{l.after ? JSON.stringify(l.after) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
/** A-16 システム設定：招待制、上限値、メンテナンスモード（ZS-ADM-22）＋無料枠のデモ */
export function SystemSettings() {
  const s = useSync(() => api.admin.settings())
  const run = useRun()
  const [confirmMaint, setConfirmMaint] = useState(false)
  const [metric, setMetric] = useState<UsageMetric>('db_bytes')
  const save = (patch: Partial<AppSettings>) => run(() => api.admin.updateSettings(patch), '保存しました')
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-title-l">システム設定</h1>
      <section className="card space-y-2 p-5">
        <h2 className="text-title-m">登録</h2>
        <Switch
          label="招待制モード（ZS-ONE-05）"
          description="オンにすると、招待コードがないと新規登録できません。クローズドβで使います"
          checked={s.inviteOnly}
          onChange={(v) => save({ inviteOnly: v })}
        />
      </section>
      <section className="card grid gap-3 p-5 sm:grid-cols-2">
        <h2 className="text-title-m sm:col-span-2">上限値</h2>
        <TextField
          type="number"
          label="送信レート（1分あたり）"
          value={s.sendRatePerMinute}
          onChange={(e) => save({ sendRatePerMinute: Number(e.target.value) })}
        />
        <TextField
          type="number"
          label="登録24時間以内の新規トーク（1日）"
          value={s.newUserDailyNewTalks}
          onChange={(e) => save({ newUserDailyNewTalks: Number(e.target.value) })}
        />
        <TextField type="number" label="グループの上限人数" value={s.groupMaxMembers} onChange={(e) => save({ groupMaxMembers: Number(e.target.value) })} />
        <TextField type="number" label="アップロード上限（MB）" value={s.uploadMaxMb} onChange={(e) => save({ uploadMaxMb: Number(e.target.value) })} />
        <TextField
          type="number"
          label="作品の自動非表示（通報数）"
          value={s.reportAutoHideThreshold}
          onChange={(e) => save({ reportAutoHideThreshold: Number(e.target.value) })}
        />
        <TextField
          type="number"
          label="通常配信の1日上限（1人あたり）"
          value={s.broadcastDailyLimit}
          onChange={(e) => save({ broadcastDailyLimit: Number(e.target.value) })}
        />
        <div className="sm:col-span-2">
          <Switch label="一斉配信の承認フロー（ZS-BC-06）" checked={s.broadcastApprovalRequired} onChange={(v) => save({ broadcastApprovalRequired: v })} />
        </div>
      </section>
      <section className="card space-y-3 p-5">
        <h2 className="text-title-m">メンテナンスモード</h2>
        <TextField
          label="終了予定（表示用）"
          value={s.maintenance.until ?? ''}
          onChange={(e) => save({ maintenance: { ...s.maintenance, until: e.target.value || null } })}
          placeholder="例：12:00"
        />
        <TextArea
          label="メッセージ"
          value={s.maintenance.message}
          onChange={(e) => save({ maintenance: { ...s.maintenance, message: e.target.value } })}
          rows={2}
        />
        <Button
          variant={s.maintenance.enabled ? 'secondary' : 'warning'}
          onClick={() => (s.maintenance.enabled ? save({ maintenance: { ...s.maintenance, enabled: false } }) : setConfirmMaint(true))}
        >
          {s.maintenance.enabled ? 'メンテナンスを終了する' : 'メンテナンスを開始する'}
        </Button>
        <p className="text-caption text-fg2">
          メンテナンス中も運営メンバーはアプリと運営コンソールを使えます。24時間前までに公式アカウントとバナーで告知してください。
        </p>
      </section>
      <section id="usage" className="card space-y-3 p-5">
        <h2 className="text-title-m">無料枠の逼迫（デモ）</h2>
        <p className="text-body-m text-fg2">使用量を書き換えて、無料枠メーターの色と「重い機能の一時停止」（画像の送信だけ停止）を確認できます。</p>
        <div className="flex flex-wrap items-end gap-2">
          <Select
            value={metric}
            onChange={(v) => setMetric(v as UsageMetric)}
            options={Object.entries(USAGE_LIMITS).map(([k, v]) => ({ value: k, label: v.label }))}
          />
          {[0.3, 0.75, 0.92].map((p) => (
            <Button
              key={p}
              size="sm"
              variant="secondary"
              icon={<RefreshCw className="size-3.5" />}
              onClick={() => run(() => api.admin.simulateUsage(metric, p), `${Math.round(p * 100)}%にしました`)}
            >
              {Math.round(p * 100)}%
            </Button>
          ))}
        </div>
        <p className="text-body-m">重い機能の一時停止：{s.heavyFeaturesPaused ? <Badge tone="danger">停止中</Badge> : <Badge tone="success">通常</Badge>}</p>
        <table className="w-full text-left text-caption">
          <thead className="text-fg2">
            <tr>
              <th className="py-1">指標</th>
              <th className="py-1">注意（70%）</th>
              <th className="py-1">判断（90%）</th>
              <th className="py-1">移行先</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['DB容量', '350MB', '450MB', 'Supabase Pro 月25ドル'],
              ['リアルタイム配信', '月140万件', '月180万件', '同上'],
              ['同時接続', '140', '180', '同上'],
              ['転送量', '月3.5GB', '月4.5GB', '同上'],
              ['R2 保存容量', '7GB', '9GB', 'R2 従量課金'],
              ['Workers リクエスト', '1日7万', '1日9万', 'Workers Paid 月5ドル'],
            ].map((r) => (
              <tr key={r[0]} className="border-t border-subtle">
                {r.map((c, i) => (
                  <td key={i} className="py-1.5">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <ConfirmDialog
        open={confirmMaint}
        onClose={() => setConfirmMaint(false)}
        title="メンテナンスを開始しますか？"
        body="運営メンバー以外のユーザーはアプリを使えなくなります。"
        confirmLabel="開始する"
        danger
        requireText="メンテナンス"
        onConfirm={() => (setConfirmMaint(false), save({ maintenance: { ...s.maintenance, enabled: true } }))}
      />
    </div>
  )
}
