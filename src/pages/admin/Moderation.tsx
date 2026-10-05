import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Star, EyeOff, Eye, Clock } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { useLive } from '@/hooks/useLive'
import { useDebounced } from '@/hooks/misc'
import { useMe } from '@/app/session'
import { Avatar, Badge, Button, Segmented, Tabs, TextField } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import { formatDateTime, formatCount, formatRelative } from '@/lib/format'
import { WORK_TYPE_LABEL } from '@/lib/constants'
import type { ReportStatus } from '@/lib/types'
import { cn } from '@/lib/cn'
import { useAdminRole } from './AdminLayout'
import { can } from '@/lib/api/shared'

const STATUS_LABEL: Record<ReportStatus, string> = { open: '未対応', in_progress: '対応中', resolved: '対応済み', rejected: '却下' }

/** A-05 通報キュー：作品・ユーザー・メッセージの通報を1つのキューで（ZS-ADM-13〜16） */
export function Reports() {
  const [status, setStatus] = useState<ReportStatus | 'all'>('open')
  const { data } = useLive(() => api.admin.reports(status), [status])
  const [sel, setSel] = useState<string | null>(null)
  const me = useMe()!
  const toast = useToast()
  const current = data?.find((r) => r.report.id === sel) ?? data?.[0]
  const update = async (id: string, patch: Parameters<typeof api.admin.updateReport>[1], ok: string) => {
    try {
      await api.admin.updateReport(id, patch)
      toast({ text: ok })
    } catch (e) {
      toast({ text: errorMessage(e), tone: 'error' })
    }
  }
  return (
    <div className="space-y-4">
      <h1 className="text-title-l">通報キュー</h1>
      <Tabs
        value={status}
        onChange={setStatus}
        tabs={[
          { value: 'open', label: '未対応' },
          { value: 'in_progress', label: '対応中' },
          { value: 'resolved', label: '対応済み' },
          { value: 'rejected', label: '却下' },
          { value: 'all', label: 'すべて' },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <ul className="card divide-y divide-[var(--border-subtle)] overflow-hidden">
          {data?.length === 0 && <li className="p-6 text-center text-fg2">通報はありません</li>}
          {data?.map(({ report: r, target }) => {
            const hours = (Date.now() - new Date(r.createdAt).getTime()) / 3600_000
            const overdue = hours > 24 && (r.status === 'open' || r.status === 'in_progress')
            return (
              <li key={r.id}>
                <button
                  onClick={() => setSel(r.id)}
                  className={cn('flex w-full items-start gap-3 p-3 text-left hover:bg-surface', current?.report.id === r.id && 'bg-surface')}
                >
                  <Badge tone={r.targetType === 'work' ? 'aurora' : r.targetType === 'user' ? 'brand' : 'muted'}>
                    {{ work: '作品', user: 'ユーザー', message: 'メッセージ' }[r.targetType]}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-m font-bold">{target.label}</span>
                    <span className="block text-caption text-fg2">
                      {r.reason}・{STATUS_LABEL[r.status]}
                      {r.assigneeId && `・担当 ${api.app.profileName(r.assigneeId)}`}
                    </span>
                  </span>
                  {/* ZS-ADM-15 24時間を超えたものを強調 */}
                  <span className={cn('flex items-center gap-1 text-caption tabular', overdue ? 'font-bold text-danger' : 'text-fg2')}>
                    <Clock className="size-3.5" />
                    {formatRelative(r.createdAt)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        {current && (
          <section className="card space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-title-m">{current.target.label}</h2>
              <Badge tone="warning">{STATUS_LABEL[current.report.status]}</Badge>
            </div>
            <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-body-m">
              <dt className="text-fg2">理由</dt>
              <dd>{current.report.reason}</dd>
              <dt className="text-fg2">通報者</dt>
              <dd>{current.reporter?.displayName ?? '—'}</dd>
              <dt className="text-fg2">日時</dt>
              <dd>{formatDateTime(current.report.createdAt)}</dd>
              <dt className="text-fg2">過去の通報数</dt>
              <dd>{current.pastCount}件</dd>
            </dl>
            {current.report.detail && <p className="rounded-[12px] bg-surface p-3 text-body-m">{current.report.detail}</p>}
            {current.report.sharedMessages && (
              <div className="space-y-1">
                <p className="text-label">通報者が提供したメッセージ（前後5件）</p>
                <ol className="space-y-1 rounded-[12px] bg-surface p-3 text-body-m">
                  {current.report.sharedMessages.map((m) => (
                    <li key={m.id} className={cn(String(m.id) === current.report.targetId && 'rounded bg-warning/15 px-1')}>
                      <span className="text-caption text-fg2">{api.app.profileName(m.senderId)}：</span>
                      {m.body || `[${m.kind}]`}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {current.target.link && (
                <Link to={current.target.link}>
                  <Button variant="secondary" size="sm">
                    対象を開く
                  </Button>
                </Link>
              )}
              {current.target.ownerId && (
                <Link to={`/admin/users/${current.target.ownerId}`}>
                  <Button variant="warning" size="sm">
                    利用制限へ
                  </Button>
                </Link>
              )}
              {current.report.targetType === 'work' && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<EyeOff className="size-4" />}
                  onClick={() =>
                    api.admin
                      .setWorkHidden(current.report.targetId, true, `通報（${current.report.reason}）の確認により非公開`)
                      .then(() => toast({ text: '非公開にしました' }))
                  }
                >
                  作品を非公開
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 border-t border-subtle pt-3">
              <Button size="sm" variant="secondary" onClick={() => update(current.report.id, { status: 'in_progress', assigneeId: me.id }, '担当になりました')}>
                担当する
              </Button>
              <Button size="sm" onClick={() => update(current.report.id, { status: 'resolved' }, '対応済みにしました（通報者に通知）')}>
                対応済みにする
              </Button>
              <Button size="sm" variant="ghost" onClick={() => update(current.report.id, { status: 'rejected' }, '却下しました')}>
                却下
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

/** A-06 作品管理：検索、非公開化、ピックアップ（ZS-ADM-17） */
export function WorksAdmin() {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'hidden' | 'pickup'>('all')
  const dq = useDebounced(q, 250)
  const { data } = useLive(() => api.admin.works(dq, filter), [dq, filter])
  const role = useAdminRole()
  const toast = useToast()
  const [reason, setReason] = useState('')
  return (
    <div className="space-y-4">
      <h1 className="text-title-l">作品管理</h1>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="タイトル、制作者"
            aria-label="作品検索"
            className="min-h-11 w-full rounded-[12px] border border-subtle bg-surface pl-9 pr-3"
          />
        </div>
        <Segmented
          label="絞り込み"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'すべて' },
            { value: 'hidden', label: '非公開' },
            { value: 'pickup', label: 'ピックアップ' },
          ]}
        />
      </div>
      <TextField
        label="非公開にする理由（本人に届きます）"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="例：他人の作品の無断掲載の疑い"
      />
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-body-m">
          <thead className="text-caption text-fg2">
            <tr className="border-b border-subtle">
              <th className="p-3">作品</th>
              <th className="p-3">制作者</th>
              <th className="p-3">数値</th>
              <th className="p-3">通報</th>
              <th className="p-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {data?.map(({ work: w, owner, pickup, reports }) => (
              <tr key={w.id} className="border-b border-subtle last:border-0">
                <td className="p-3">
                  <Link to={`/works/${w.id}`} className="flex items-center gap-3">
                    <img src={w.media[0]?.thumbUrl} alt="" className="aspect-[16/10] w-20 rounded-[6px] object-cover" />
                    <span>
                      <span className="block font-bold">{w.title}</span>
                      <span className="text-caption text-fg2">
                        {WORK_TYPE_LABEL[w.type]}
                        {w.status === 'hidden' && (
                          <Badge tone="warning" className="ml-1">
                            非公開
                          </Badge>
                        )}
                        {w.visibility === 'unlisted' && <Badge className="ml-1">限定公開</Badge>}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="p-3">
                  <span className="flex items-center gap-2">
                    <Avatar name={owner.displayName} color={owner.avatarColor} url={owner.avatarUrl} size={24} />
                    {owner.displayName}
                  </span>
                </td>
                <td className="p-3 text-caption text-fg2 tabular">
                  いいね {formatCount(w.likeCount)}・閲覧 {formatCount(w.viewCount)}
                </td>
                <td className="p-3">{reports ? <Badge tone="danger">{reports}件</Badge> : '—'}</td>
                <td className="p-3">
                  <div className="flex justify-end gap-1">
                    {can(role, 'pickup') && (
                      <Button
                        size="sm"
                        variant={pickup ? 'primary' : 'secondary'}
                        icon={<Star className={cn('size-4', pickup && 'fill-current')} />}
                        onClick={() => api.admin.setPickup(w.id, !pickup).catch((e) => toast({ text: errorMessage(e), tone: 'error' }))}
                      >
                        {pickup ? 'ピックアップ中' : 'ピックアップ'}
                      </Button>
                    )}
                    {can(role, 'hideWork') && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={w.status === 'hidden' ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                        onClick={() =>
                          api.admin
                            .setWorkHidden(w.id, w.status !== 'hidden', reason)
                            .then(() => toast({ text: w.status === 'hidden' ? '公開に戻しました' : '非公開にしました' }))
                        }
                      >
                        {w.status === 'hidden' ? '公開に戻す' : '非公開化'}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
