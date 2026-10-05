import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Search, ShieldAlert, Smartphone, Download } from 'lucide-react'
import { api, errorMessage, type UserState } from '@/lib/api'
import { useLive } from '@/hooks/useLive'
import { useDebounced } from '@/hooks/misc'
import { Avatar, Badge, Button, ConfirmDialog, Segmented, Select, Tabs, TextArea, TextField } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import { DURATION_PRESETS, RESTRICTION_INFO, isActiveRestriction } from '@/lib/restrictions'
import { RESTRICTION_REASONS } from '@/lib/constants'
import { formatDateTime, formatFullDate, formatRelative } from '@/lib/format'
import type { RestrictionKind } from '@/lib/types'
import { cn } from '@/lib/cn'
import { useAdminRole, ROLE_LABEL } from './AdminLayout'
import { can } from '@/lib/api/shared'

const STATE_LABEL: Record<UserState, { label: string; tone: 'muted' | 'warning' | 'danger' | 'aurora' }> = {
  normal: { label: '通常', tone: 'muted' },
  restricted: { label: '制限中', tone: 'warning' },
  frozen: { label: '凍結', tone: 'danger' },
  banned: { label: '永久停止', tone: 'danger' },
  leaving: { label: '退会予定', tone: 'aurora' },
}

/** A-03 ユーザー一覧：検索、状態フィルタ、一括操作（＋重複の疑い・異議申し立て） */
export default function Users() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as 'list' | 'dup' | 'appeals') ?? 'list'
  return (
    <div className="space-y-4">
      <h1 className="text-title-l">ユーザー</h1>
      <Tabs
        value={tab}
        onChange={(t) => setParams(t === 'list' ? {} : { tab: t })}
        tabs={[
          { value: 'list', label: '一覧' },
          { value: 'dup', label: '重複の疑い' },
          { value: 'appeals', label: '異議申し立て' },
        ]}
      />
      {tab === 'list' && <UserList />}
      {tab === 'dup' && <DupList />}
      {tab === 'appeals' && <Appeals />}
    </div>
  )
}

function UserList() {
  const [q, setQ] = useState('')
  const [state, setState] = useState<UserState | 'all'>('all')
  const dq = useDebounced(q, 250)
  const { data } = useLive(() => api.admin.searchUsers(dq, state), [dq, state])
  const [sel, setSel] = useState<string[]>([])
  const [bulk, setBulk] = useState(false)
  const role = useAdminRole()
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="表示名、ユーザーID、メールアドレス、内部ID"
            aria-label="ユーザー検索"
            className="min-h-11 w-full rounded-[12px] border border-subtle bg-surface pl-9 pr-3"
          />
        </div>
        <Select
          value={state}
          onChange={(v) => setState(v as UserState | 'all')}
          options={[{ value: 'all', label: 'すべての状態' }, ...Object.entries(STATE_LABEL).map(([v, s]) => ({ value: v, label: s.label }))]}
        />
        {can(role, 'restrict') && (
          <Button variant="warning" disabled={!sel.length} onClick={() => setBulk(true)}>
            選択した{sel.length}人に一括制限
          </Button>
        )}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-body-m">
          <thead className="text-caption text-fg2">
            <tr className="border-b border-subtle">
              <th className="w-10 p-3">
                <input
                  type="checkbox"
                  aria-label="すべて選択"
                  className="size-4"
                  checked={!!data?.length && sel.length === data.length}
                  onChange={(e) => setSel(e.target.checked ? (data ?? []).map((x) => x.profile.id) : [])}
                />
              </th>
              <th className="p-3">ユーザー</th>
              <th className="p-3">メール</th>
              <th className="p-3">状態</th>
              <th className="p-3">登録日</th>
              <th className="p-3">最終ログイン</th>
            </tr>
          </thead>
          <tbody>
            {data?.map(({ profile: p, state, email }) => (
              <tr key={p.id} className="border-b border-subtle last:border-0 hover:bg-surface">
                <td className="p-3">
                  <input
                    type="checkbox"
                    aria-label={`${p.displayName}を選択`}
                    className="size-4"
                    checked={sel.includes(p.id)}
                    onChange={() => setSel((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))}
                  />
                </td>
                <td className="p-3">
                  <Link to={`/admin/users/${p.id}`} className="flex items-center gap-2">
                    <Avatar name={p.displayName} color={p.avatarColor} url={p.avatarUrl} size={32} />
                    <span>
                      <span className="block font-bold">{p.displayName}</span>
                      <span className="text-caption text-fg2">@{p.handle}</span>
                    </span>
                  </Link>
                </td>
                <td className="p-3 text-caption text-fg2">{email}</td>
                <td className="p-3">
                  <Badge tone={STATE_LABEL[state].tone}>{STATE_LABEL[state].label}</Badge>
                </td>
                <td className="p-3 tabular">{formatFullDate(p.createdAt)}</td>
                <td className="p-3 text-fg2">{formatRelative(p.lastLoginAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bulk && <RestrictDialog userIds={sel} onClose={() => (setBulk(false), setSel([]))} />}
    </>
  )
}

/** A-04 ユーザー詳細：左に要約、中央に履歴、右に利用制限パネル（14.9） */
export function UserDetail() {
  const { id = '' } = useParams()
  const { data } = useLive(() => api.admin.userDetail(id), [id])
  const role = useAdminRole()
  const toast = useToast()
  const [lift, setLift] = useState<string | null>(null)
  if (!data) return <p className="text-fg2">読み込み中…</p>
  const p = data.profile
  const timeline = [
    { at: p.createdAt, label: '登録', tone: 'muted' as const, body: '' },
    ...data.restrictions.map((r) => ({
      at: r.startsAt,
      label: RESTRICTION_INFO[r.kind].label,
      tone: 'warning' as const,
      body: `${r.reasonCategory}${r.endsAt ? `・${formatDateTime(r.endsAt)}まで` : ''}${r.liftedAt ? '（解除済み）' : ''}${r.internalNote ? `\nメモ：${r.internalNote}` : ''}`,
      id: r.id,
      active: isActiveRestriction(r),
    })),
    ...data.reportsAbout.map((r) => ({ at: r.createdAt, label: `通報：${r.reason}`, tone: 'danger' as const, body: r.detail })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1))
  return (
    <div className="space-y-4">
      <Link to="/admin/users" className="text-caption text-brand-text">
        ← ユーザー一覧
      </Link>
      <div className="grid gap-4 xl:grid-cols-[280px_1fr_380px]">
        <section className="card space-y-3 p-4">
          <div className="flex items-center gap-3">
            <Avatar name={p.displayName} color={p.avatarColor} url={p.avatarUrl} size={56} />
            <div>
              <p className="text-title-m">{p.displayName}</p>
              <p className="text-caption text-fg2">@{p.handle}</p>
            </div>
          </div>
          <Badge tone={STATE_LABEL[data.state].tone}>{STATE_LABEL[data.state].label}</Badge>
          {data.adminRole && <Badge tone="brand">運営：{ROLE_LABEL[data.adminRole]}</Badge>}
          <dl className="grid grid-cols-[96px_1fr] gap-y-1 text-caption">
            <dt className="text-fg2">内部ID</dt>
            <dd className="break-all">{p.id}</dd>
            <dt className="text-fg2">ログイン手段</dt>
            <dd>{data.identities.map((i) => `${i.kind}: ${i.value}`).join('\n')}</dd>
            <dt className="text-fg2">登録日</dt>
            <dd>{formatFullDate(p.createdAt)}</dd>
            <dt className="text-fg2">最終ログイン</dt>
            <dd>{formatRelative(p.lastLoginAt)}</dd>
            <dt className="text-fg2">送信数</dt>
            <dd>{data.stats.messagesSent}</dd>
            <dt className="text-fg2">いいね</dt>
            <dd>
              {data.stats.likesGiven}（獲得 {data.stats.likesReceived}）
            </dd>
            <dt className="text-fg2">作品</dt>
            <dd>{data.works.length}件</dd>
            <dt className="text-fg2">通報した数</dt>
            <dd>{data.reportsBy}件</dd>
          </dl>
          <div className="space-y-1">
            <p className="flex items-center gap-1 text-label">
              <Smartphone className="size-4" />
              ログイン端末
            </p>
            {data.devices.map((d) => (
              <p key={d.deviceHash} className="text-caption text-fg2">
                {d.deviceHash.slice(0, 16)}…・{formatRelative(d.lastSeenAt)}
              </p>
            ))}
            {data.sameDevice.length > 0 && (
              <p className="text-caption text-warning">同じ端末のアカウント：{data.sameDevice.map((x) => x.displayName).join('、')}</p>
            )}
          </div>
          <p className="text-caption text-fg2">メッセージ本文は表示しません（ZS-ADM-11）。</p>
          {can(role, 'export') && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Download className="size-4" />}
              onClick={async () => {
                const blob = new Blob([await api.admin.exportUser(p.id)], { type: 'application/json' })
                const a = document.createElement('a')
                a.href = URL.createObjectURL(blob)
                a.download = `user-${p.handle}.json`
                a.click()
              }}
            >
              個人データを出力
            </Button>
          )}
        </section>

        <section className="card space-y-3 p-4">
          <h2 className="text-title-m">履歴</h2>
          <ol className="space-y-3 border-l border-subtle pl-4">
            {timeline.map((t, i) => (
              <li key={i} className="relative">
                <span
                  className={cn(
                    'absolute -left-[21px] top-1.5 size-2.5 rounded-full',
                    t.tone === 'warning' ? 'bg-warning' : t.tone === 'danger' ? 'bg-danger' : 'bg-fg2',
                  )}
                />
                <p className="text-body-m font-bold">
                  {t.label}
                  {'active' in t && t.active && (
                    <Badge tone="warning" className="ml-2">
                      有効
                    </Badge>
                  )}
                </p>
                <p className="text-caption text-fg2 tabular">{formatDateTime(t.at)}</p>
                {t.body && <p className="whitespace-pre-wrap text-caption text-fg2">{t.body}</p>}
                {'active' in t && t.active && can(role, 'restrict') && (
                  <Button size="sm" variant="ghost" className="mt-1" onClick={() => setLift(t.id!)}>
                    解除する
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </section>

        {can(role, 'restrict') ? (
          <RestrictPanel userIds={[p.id]} name={p.displayName} />
        ) : (
          <section className="card p-4 text-body-m text-fg2">利用制限の権限がありません</section>
        )}
      </div>
      <ConfirmDialog
        open={!!lift}
        onClose={() => setLift(null)}
        title="制限を解除しますか？"
        body="本人に公式アカウントから解除を知らせます。"
        confirmLabel="解除する"
        onConfirm={async () => {
          try {
            await api.admin.liftRestriction(lift!, '手動解除')
            toast({ text: '解除しました' })
          } catch (e) {
            toast({ text: errorMessage(e), tone: 'error' })
          }
          setLift(null)
        }}
      />
    </div>
  )
}

/** ZS-ADM-01 制限の実行：種類、期間、理由カテゴリ、ユーザー向け文面、社内メモ */
function RestrictPanel({ userIds, name, onDone }: { userIds: string[]; name: string; onDone?: () => void }) {
  const role = useAdminRole()
  const toast = useToast()
  const [kind, setKind] = useState<RestrictionKind>('chat_send')
  const [preset, setPreset] = useState<number>(1)
  const [until, setUntil] = useState('')
  const [reason, setReason] = useState(RESTRICTION_REASONS[0])
  const [message, setMessage] = useState('')
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const info = RESTRICTION_INFO[kind]
  const heavy = kind === 'ban' || userIds.length > 1
  const kinds = (Object.keys(RESTRICTION_INFO) as RestrictionKind[]).filter((k) => (k === 'ban' || k === 'freeze' ? can(role, 'ban') : true))

  const exec = async () => {
    setBusy(true)
    try {
      const ids = await api.admin.restrict({
        userIds,
        kind,
        durationMs: until ? null : DURATION_PRESETS[preset].ms,
        until: until || null,
        reasonCategory: reason,
        userMessage: message,
        internalNote: note,
      })
      setConfirm(false)
      onDone?.()
      // 実行後は「元に戻す」付きのトーストを10秒（永久停止は対象外）
      toast({
        text: `${info.label}を実行しました`,
        ms: 10_000,
        action:
          kind === 'ban'
            ? undefined
            : {
                label: '元に戻す',
                onClick: () =>
                  void api.admin
                    .undoRestrictions(ids)
                    .then(() => toast({ text: '取り消しました' }))
                    .catch((e) => toast({ text: errorMessage(e), tone: 'error' })),
              },
      })
    } catch (e) {
      toast({ text: errorMessage(e), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card space-y-4 p-4">
      <h2 className="flex items-center gap-2 text-title-m">
        <ShieldAlert className="size-5 text-warning" /> 利用制限
      </h2>
      <div className="flex flex-wrap gap-1.5">
        {kinds.map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={cn('min-h-9 rounded-full border px-3 text-label', kind === k ? 'border-transparent bg-brand text-white' : 'border-subtle')}
          >
            {RESTRICTION_INFO[k].label}
          </button>
        ))}
      </div>
      {/* 種類を選ぶと「止まること」と「続けてできること」をその場で表示する */}
      <dl className="grid grid-cols-[96px_1fr] gap-y-1 rounded-[12px] bg-surface p-3 text-caption">
        <dt className="text-fg2">止まること</dt>
        <dd>{info.stops}</dd>
        <dt className="text-fg2">できること</dt>
        <dd>{info.continues}</dd>
        <dt className="text-fg2">主な用途</dt>
        <dd>{info.use}</dd>
      </dl>
      {kind !== 'warning' && kind !== 'ban' && (
        <div className="space-y-2">
          <p className="text-label">期間</p>
          <div className="flex flex-wrap gap-1.5">
            {DURATION_PRESETS.map((d, i) => (
              <button
                key={d.label}
                onClick={() => (setPreset(i), setUntil(''))}
                aria-pressed={preset === i && !until}
                className={cn(
                  'min-h-9 rounded-full border px-3 text-label',
                  preset === i && !until ? 'border-transparent bg-brand text-white' : 'border-subtle',
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
          <TextField type="datetime-local" label="日時指定" value={until} onChange={(e) => setUntil(e.target.value)} />
        </div>
      )}
      <Select label="理由カテゴリ" value={reason} onChange={setReason} options={RESTRICTION_REASONS.map((r) => ({ value: r, label: r }))} />
      <TextArea
        label="ユーザー向け文面（公式アカウントから届きます）"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        placeholder="テンプレートの文面に追記します"
      />
      <TextArea label="社内メモ（本人には見えません）" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      {/* 通知のスマホプレビュー */}
      <div className="rounded-[16px] border border-subtle bg-base p-3">
        <p className="mb-2 text-caption text-fg2">{name} さんに届く通知のプレビュー</p>
        <div className="relative overflow-hidden rounded-[18px] border border-subtle bg-bubble-official px-3 py-2 text-body-m">
          <span className="bg-signature absolute inset-y-0 left-0 w-0.5" />【{info.label}】
          {message || '利用規約に反する行為が確認されたため、利用を制限しています。'}
        </div>
      </div>
      <Button
        block
        size="lg"
        variant={info.severity === 'danger' ? 'danger' : info.severity === 'warning' ? 'warning' : 'primary'}
        loading={busy}
        onClick={() => (heavy ? setConfirm(true) : exec())}
      >
        {userIds.length > 1 ? `${userIds.length}人に` : ''}
        {info.label}を実行
      </Button>
      {/* ZS-ADM-09 永久停止と一括制限は二重確認 */}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`${info.label}を実行しますか？`}
        body={
          <>
            対象：{userIds.length}人（{name}）
            <br />
            理由：{reason}
          </>
        }
        confirmLabel="実行する"
        danger
        requireText={kind === 'ban' ? '永久停止' : `${userIds.length}人`}
        loading={busy}
        onConfirm={exec}
      />
    </section>
  )
}

function RestrictDialog({ userIds, onClose }: { userIds: string[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/55" onClick={onClose} />
      <div className="relative max-h-[90dvh] w-full max-w-md overflow-y-auto">
        <RestrictPanel userIds={userIds} name={`${userIds.length}人`} onDone={onClose} />
      </div>
    </div>
  )
}

/** ZS-ONE-04 / ZS-ADM-12 重複疑いのレビュー */
function DupList() {
  const { data } = useLive(() => api.admin.dupSuspicions(), [])
  const toast = useToast()
  const navigate = useNavigate()
  return (
    <div className="space-y-3">
      {data?.length === 0 && <p className="text-fg2">重複の疑いはありません</p>}
      {data?.map((s) => (
        <section key={s.id} className="card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <p className="text-body-m font-bold">同じ端末から {s.users.length}アカウント</p>
            <Badge tone={s.status === 'open' ? 'warning' : 'muted'}>
              {{ open: '未確認', ok: '問題なし', confirm: '本人に確認中', suspended: '停止' }[s.status]}
            </Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {s.users.map((u) => (
              <button key={u.id} onClick={() => navigate(`/admin/users/${u.id}`)} className="flex items-center gap-3 rounded-[12px] bg-surface p-3 text-left">
                <Avatar name={u.displayName} color={u.avatarColor} url={u.avatarUrl} size={40} />
                <span className="text-body-m">
                  {u.displayName}
                  <span className="block text-caption text-fg2">
                    @{u.handle}・登録 {formatFullDate(u.createdAt)}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {s.decision && <p className="text-caption text-fg2">判断：{s.decision}</p>}
          <Segmented
            label="判断"
            value={s.status === 'open' ? ('' as never) : (s.status as 'ok' | 'confirm' | 'suspended')}
            onChange={async (v) => {
              try {
                await api.admin.decideDup(s.id, v, v === 'ok' ? '家族・共用端末と判断' : v === 'confirm' ? '本人に確認' : '複数アカウントのため停止')
                toast({ text: '判断を記録しました' })
              } catch (e) {
                toast({ text: errorMessage(e), tone: 'error' })
              }
            }}
            options={[
              { value: 'ok', label: '問題なし' },
              { value: 'confirm', label: '本人に確認' },
              { value: 'suspended', label: '停止' },
            ]}
          />
        </section>
      ))}
    </div>
  )
}

function Appeals() {
  const { data } = useLive(() => api.admin.appeals(), [])
  const toast = useToast()
  const [result, setResult] = useState<Record<string, string>>({})
  return (
    <div className="space-y-3">
      {data?.length === 0 && <p className="text-fg2">異議申し立てはありません</p>}
      {data?.map(({ appeal: a, user, restriction }) => (
        <section key={a.id} className="card space-y-2 p-4">
          <div className="flex items-center justify-between">
            <Link to={`/admin/users/${user.id}`} className="text-body-m font-bold text-brand-text">
              {user.displayName}
            </Link>
            <Badge tone={a.status === 'open' ? 'warning' : 'muted'}>{{ open: '受付', reviewing: '再審中', lifted: '解除', kept: '維持' }[a.status]}</Badge>
          </div>
          <p className="text-caption text-fg2">
            対象：{restriction ? RESTRICTION_INFO[restriction.kind].label : '—'}・{formatDateTime(a.createdAt)}
          </p>
          <p className="whitespace-pre-wrap text-body-m">{a.body}</p>
          {(a.status === 'open' || a.status === 'reviewing') && (
            <>
              <TextArea
                label="結果の説明（本人に届きます）"
                rows={2}
                value={result[a.id] ?? ''}
                onChange={(e) => setResult({ ...result, [a.id]: e.target.value })}
              />
              <div className="flex gap-2">
                {(['reviewing', 'lifted', 'kept'] as const).map((d) => (
                  <Button
                    key={d}
                    size="sm"
                    variant={d === 'lifted' ? 'primary' : 'secondary'}
                    onClick={() =>
                      api.admin
                        .decideAppeal(a.id, d, result[a.id] ?? '')
                        .then(() => toast({ text: '記録しました' }))
                        .catch((e) => toast({ text: errorMessage(e), tone: 'error' }))
                    }
                  >
                    {{ reviewing: '再審する', lifted: '解除する', kept: '維持する' }[d]}
                  </Button>
                ))}
              </div>
            </>
          )}
        </section>
      ))}
    </div>
  )
}
