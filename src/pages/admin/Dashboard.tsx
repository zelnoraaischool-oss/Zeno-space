import { Link } from 'react-router-dom'
import { Flag, Megaphone, Newspaper, Users2, AlertTriangle, Scale } from 'lucide-react'
import { api } from '@/lib/api'
import { useLive } from '@/hooks/useLive'
import { LineChart, Meter, StatTile } from '@/components/charts'
import { Badge } from '@/components/ui/primitives'
import { formatBytes, formatDateTime, formatFullDate, formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'

/** A-02 ダッシュボード（14.8）：要対応を左上、指標はその下 */
export default function Dashboard() {
  const { data } = useLive(() => api.admin.dashboard(), [])
  const usage = useLive(() => api.admin.usage(), [])
  if (!data) return <p className="text-fg2">読み込み中…</p>
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
  const week = (a: number[]) => a.slice(-7)
  // 前週比：直近7日の合計と、その前の7日の合計を比べる
  const delta = (a: number[]) => {
    const cur = sum(a.slice(-7))
    const prev = sum(a.slice(0, -7))
    return prev ? (cur - prev) / prev : null
  }
  const dayLabels = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.now() - (n - 1 - i) * 86400_000)
      return `${d.getMonth() + 1}/${d.getDate()}`
    })
  const l30 = dayLabels(30)
  const newsStatus = data.newsToday
    ? { collecting: '収集中', pending: '承認待ち', approved: '承認済み（予約）', sent: '配信済み', skipped: '配信なし（3本未満）', failed: '失敗' }[
        data.newsToday.status
      ]
    : '未実行'

  return (
    <div className="space-y-8">
      <h1 className="text-title-l">ダッシュボード</h1>

      <section aria-labelledby="todo-h" className="space-y-3">
        <h2 id="todo-h" className="text-title-m">
          要対応
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Todo
            to="/admin/reports"
            icon={Flag}
            label="未対応の通報"
            value={data.openReports}
            danger={data.overdueReports > 0}
            note={data.overdueReports ? `うち24時間超 ${data.overdueReports}件` : '24時間以内に初回対応'}
          />
          <Todo to="/admin/broadcasts" icon={Megaphone} label="承認待ちの配信" value={data.pendingBroadcasts} />
          <Todo to="/admin/news" icon={Newspaper} label="今日のAIニュース" value={newsStatus} highlight={data.newsToday?.status === 'pending'} />
          <Todo
            to="/admin/users?tab=dup"
            icon={Users2}
            label="重複の疑い"
            value={data.dupOpen}
            note={data.appealsOpen ? `異議申し立て ${data.appealsOpen}件` : undefined}
          />
        </div>
        {data.failingSources.length > 0 && (
          <p className="flex items-center gap-2 text-body-m text-warning">
            <AlertTriangle className="size-4" /> 取得に失敗している情報源：{data.failingSources.map((s) => `${s.name}（${s.failureCount}回）`).join('、')}
          </p>
        )}
      </section>

      <section aria-labelledby="kpi-h" className="space-y-3">
        <h2 id="kpi-h" className="text-title-m">
          指標
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <StatTile label="DAU" value={formatNumber(data.dau)} />
          <StatTile label="WAU" value={formatNumber(data.wau)} />
          <StatTile label="新規登録（7日）" value={formatNumber(sum(week(data.newUsers)))} series={week(data.newUsers)} deltaPct={delta(data.newUsers)} />
          <StatTile label="送信メッセージ（7日）" value={formatNumber(sum(week(data.messages)))} series={week(data.messages)} deltaPct={delta(data.messages)} />
          <StatTile label="新規作品（7日）" value={formatNumber(sum(week(data.newWorks)))} series={week(data.newWorks)} deltaPct={delta(data.newWorks)} />
          <StatTile label="問い合わせ（7日）" value={formatNumber(sum(week(data.inquiries)))} series={week(data.inquiries)} deltaPct={delta(data.inquiries)} />
        </div>
        <p className="text-caption text-fg2">
          作品投稿率 {Math.round(data.kpi.postRate * 100)}%・チャット活性度（送信数÷DAU） {data.kpi.chatActivity}・総ユーザー {formatNumber(data.totalUsers)}人
        </p>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <section aria-labelledby="usage-h" className="card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 id="usage-h" className="text-title-m">
              無料枠メーター
            </h2>
            <Link to="/admin/settings#usage" className="text-caption text-brand-text">
              判断基準
            </Link>
          </div>
          {usage.data?.map((m) => (
            <Meter
              key={m.metric}
              label={m.label}
              pct={m.pct}
              valueText={`${m.unit === 'bytes' ? formatBytes(m.value) : formatNumber(m.value)} / ${m.unit === 'bytes' ? formatBytes(m.limit) : formatNumber(m.limit)}`}
              note={m.projectedDate ? `直近14日の増え方だと ${formatFullDate(m.projectedDate)} ごろ上限に届きます` : null}
            />
          ))}
          <p className="text-caption text-fg2">70%で注意、90%で警告（Slack にも通知）。90%を超えると画像の送信など重い機能だけを一時停止します。</p>
        </section>

        <div className="space-y-6">
          <section className="card space-y-3 p-5">
            <h2 className="text-title-m">今日の配信</h2>
            <div className="flex items-center gap-2 text-body-m">
              <Newspaper className="size-4 text-aurora" /> AIニュース：
              <Badge tone={data.newsToday?.status === 'sent' ? 'success' : data.newsToday?.status === 'pending' ? 'warning' : 'muted'}>{newsStatus}</Badge>
            </div>
            {data.scheduledBroadcasts.length ? (
              <ul className="space-y-1 text-body-m">
                {data.scheduledBroadcasts.map((b) => (
                  <li key={b.id} className="flex justify-between">
                    <Link to={`/admin/broadcasts/${b.id}`} className="text-brand-text">
                      {b.title || '無題'}
                    </Link>
                    <span className="text-fg2 tabular">{formatDateTime(b.scheduledAt!)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body-m text-fg2">予約配信はありません</p>
            )}
          </section>
          <section className="card space-y-6 p-5">
            <h2 className="text-title-m">30日の推移</h2>
            {/* 2つの指標は尺度が違うため、別々のグラフにする（一軸のみ） */}
            <LineChart title="登録者数（累計）" data={data.registrations30.map((v, i) => ({ label: l30[i], value: v }))} height={140} />
            <LineChart title="アクティブ数" data={data.active30.map((v, i) => ({ label: l30[i], value: v }))} height={140} />
          </section>
        </div>
      </div>
      <p className="flex items-center gap-1 text-caption text-fg2">
        <Scale className="size-3.5" /> 運営はユーザー間のメッセージ本文を閲覧しません（19.1）。数値はすべてアプリ内イベントからの集計です。
      </p>
    </div>
  )
}

function Todo({
  to,
  icon: Icon,
  label,
  value,
  note,
  danger,
  highlight,
}: {
  to: string
  icon: typeof Flag
  label: string
  value: number | string
  note?: string
  danger?: boolean
  highlight?: boolean
}) {
  return (
    <Link
      to={to}
      className={cn('card flex items-start gap-3 p-4 transition-colors hover:bg-elevated', danger && 'border-danger/50', highlight && 'border-warning/50')}
    >
      <span className={cn('flex size-10 items-center justify-center rounded-full bg-elevated', danger ? 'text-danger' : 'text-brand-text')}>
        <Icon className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-caption text-fg2">{label}</span>
        <span className={cn('block text-title-m', danger && 'text-danger')}>{value}</span>
        {note && <span className={cn('block text-caption', danger ? 'text-danger' : 'text-fg2')}>{note}</span>}
      </span>
    </Link>
  )
}
