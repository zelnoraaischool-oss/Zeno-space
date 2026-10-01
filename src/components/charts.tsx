import { useId, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, AlertOctagon } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * グラフ部品（dataviz の手順に準拠）
 * - 1系列のときは凡例を出さず、タイトルで何の値かを示す（2系列以上は小さなグラフに分ける＝一軸のみ）
 * - 線は2px、面は10%の淡い塗り、終点は r=4 の点＋2px の面色リング
 * - 目盛り線は 1px の実線で控えめに。値の文字はテキスト色（系列色にしない）
 * - ホバー／キーボードで縦線と値を表示し、同じ値は「表で見る」からも読める
 */
export interface Point {
  label: string // x の表示（例：9/28）
  value: number
}

function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * p
}

export function LineChart({
  title,
  data,
  height = 160,
  format = (n) => n.toLocaleString('ja-JP'),
  className,
}: {
  title: string
  data: Point[]
  height?: number
  format?: (n: number) => string
  className?: string
}) {
  const id = useId()
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const W = 600
  const H = height
  const pad = { l: 40, r: 16, t: 12, b: 24 }
  const max = niceMax(Math.max(...data.map((d) => d.value), 1))
  const ticks = [0, max / 2, max]
  const x = (i: number) => pad.l + (data.length <= 1 ? 0 : (i / (data.length - 1)) * (W - pad.l - pad.r))
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b)
  const path = useMemo(() => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' '), [data, max]) // eslint-disable-line react-hooks/exhaustive-deps
  const area = data.length ? `${path} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : ''
  const last = data.length - 1

  const pick = (clientX: number) => {
    const svg = svgRef.current
    if (!svg || !data.length) return
    const r = svg.getBoundingClientRect()
    const px = ((clientX - r.left) / r.width) * W
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (data.length - 1))
    setHover(Math.max(0, Math.min(last, i)))
  }

  const h = hover ?? null
  return (
    <figure className={cn('space-y-2', className)}>
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-label">{title}</span>
        {data.length > 0 && <span className="text-caption text-fg2 tabular">直近 {format(data[last].value)}</span>}
      </figcaption>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-none select-none overflow-visible outline-none"
          role="img"
          aria-label={`${title}の推移。最新は${data[last]?.label ?? ''}で${format(data[last]?.value ?? 0)}`}
          tabIndex={0}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(last)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setHover((v) => Math.max(0, (v ?? last) - 1))
            if (e.key === 'ArrowRight') setHover((v) => Math.min(last, (v ?? last) + 1))
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border-subtle)" strokeWidth={1} />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-secondary)" className="tabular">
                {format(t)}
              </text>
            </g>
          ))}
          {data.length > 1 &&
            [0, Math.floor(last / 2), last].map((i) => (
              <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'} fontSize={11} fill="var(--text-secondary)">
                {data[i].label}
              </text>
            ))}
          <path d={area} fill="var(--brand-primary-text)" opacity={0.1} />
          <path d={path} fill="none" stroke="var(--brand-primary-text)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {h !== null && <line x1={x(h)} x2={x(h)} y1={pad.t} y2={y(0)} stroke="var(--text-secondary)" strokeWidth={1} />}
          {data.length > 0 && (
            <circle cx={x(h ?? last)} cy={y(data[h ?? last].value)} r={4} fill="var(--brand-primary-text)" stroke="var(--bg-surface)" strokeWidth={2} />
          )}
        </svg>
        {h !== null && (
          <div
            className="pointer-events-none absolute top-0 rounded-[8px] border border-subtle bg-elevated px-2.5 py-1.5 shadow-lg"
            style={{ left: `${(x(h) / W) * 100}%`, transform: `translateX(${h > last / 2 ? '-110%' : '10%'})` }}
            role="status"
          >
            <p className="text-body-m font-bold tabular">{format(data[h].value)}</p>
            <p className="flex items-center gap-1.5 text-caption text-fg2">
              <span className="h-0.5 w-3 rounded bg-brand-text" aria-hidden />
              {data[h].label}
            </p>
          </div>
        )}
      </div>
      <details className="text-caption text-fg2">
        <summary className="min-h-8 cursor-pointer">表で見る</summary>
        <table className="mt-1 w-full text-left tabular" aria-labelledby={id}>
          <thead>
            <tr>
              <th className="py-1 font-medium">日付</th>
              <th className="py-1 text-right font-medium">{title}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label} className="border-t border-subtle">
                <td className="py-1">{d.label}</td>
                <td className="py-1 text-right text-fg">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

/** スパークライン：過去は控えめな色、現在の点だけアクセント */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const W = 96
  const H = 28
  const max = Math.max(...values, 1)
  const x = (i: number) => (values.length <= 1 ? 0 : (i / (values.length - 1)) * (W - 6) + 3)
  const y = (v: number) => H - 3 - (v / max) * (H - 6)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')
  const last = values.length - 1
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-7 w-24" role="img" aria-label={`${label}の7日間の推移：${values.join('、')}`}>
      <path d={d} fill="none" stroke="var(--text-secondary)" strokeOpacity={0.6} strokeWidth={1.5} strokeLinejoin="round" />
      {values.length > 0 && <circle cx={x(last)} cy={y(values[last])} r={3} fill="var(--brand-primary-text)" stroke="var(--bg-surface)" strokeWidth={1.5} />}
    </svg>
  )
}

/** 統計タイル：ラベル・値・前週比・スパークライン */
export function StatTile({
  label,
  value,
  series,
  deltaPct,
  upIsGood = true,
}: {
  label: string
  value: string
  series?: number[]
  deltaPct?: number | null
  upIsGood?: boolean
}) {
  const good = deltaPct == null ? null : deltaPct === 0 ? null : deltaPct > 0 === upIsGood
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="text-caption text-fg2">{label}</span>
      <span className="text-title-l">{value}</span>
      <div className="flex items-end justify-between gap-2">
        {deltaPct != null ? (
          <span className={cn('text-caption tabular', good === null ? 'text-fg2' : good ? 'text-success' : 'text-danger')}>
            {deltaPct > 0 ? '▲' : deltaPct < 0 ? '▼' : '±'} {Math.abs(Math.round(deltaPct * 100))}%<span className="ml-1 text-fg2">前週比</span>
          </span>
        ) : (
          <span />
        )}
        {series && <Sparkline values={series} label={label} />}
      </div>
    </div>
  )
}

/** 無料枠メーター：70%で注意、90%で警告。色だけに頼らずアイコンと文字でも示す */
export function Meter({ label, pct, valueText, note }: { label: string; pct: number; valueText: string; note?: string | null }) {
  const level = pct >= 0.9 ? 'warning' : pct >= 0.7 ? 'caution' : 'ok'
  const fill = level === 'warning' ? 'bg-danger' : level === 'caution' ? 'bg-warning' : 'bg-brand-text'
  const track = level === 'warning' ? 'bg-danger/15' : level === 'caution' ? 'bg-warning/15' : 'bg-brand-text/15'
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-body-m">
        <span className="flex items-center gap-1.5">
          {level === 'warning' ? (
            <AlertOctagon className="size-4 text-danger" aria-hidden />
          ) : level === 'caution' ? (
            <AlertTriangle className="size-4 text-warning" aria-hidden />
          ) : (
            <CheckCircle2 className="size-4 text-success" aria-hidden />
          )}
          {label}
        </span>
        <span className="text-caption text-fg2 tabular">
          {valueText}・<span className="font-bold text-fg">{Math.round(pct * 100)}%</span>
          <span className="sr-only">{level === 'warning' ? '（警告）' : level === 'caution' ? '（注意）' : '（正常）'}</span>
        </span>
      </div>
      <div
        className={cn('h-2 overflow-hidden rounded-full', track)}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct * 100)}
        aria-label={label}
      >
        <div className={cn('h-full rounded-full transition-[width] duration-500', fill)} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
      {note && <p className="text-caption text-fg2">{note}</p>}
    </div>
  )
}
