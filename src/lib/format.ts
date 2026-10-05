/** 日時はすべて JST で表示する（1.5）。保存は UTC の ISO 文字列。 */
const TZ = 'Asia/Tokyo'
const WEEK = ['日', '月', '火', '水', '木', '金', '土']

function jstParts(d: Date) {
  const f = new Intl.DateTimeFormat('ja-JP', {
    timeZone: TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  })
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]))
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    hh: p.hour,
    mm: p.minute,
    wd: WEEK[new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))).getUTCDay()],
  }
}

export function jstDateKey(iso: string | Date): string {
  const p = jstParts(new Date(iso))
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

export function formatTime(iso: string): string {
  const p = jstParts(new Date(iso))
  return `${p.hh}:${p.mm}`
}

/** 「10月3日 18:00」 */
export function formatDateTime(iso: string): string {
  const p = jstParts(new Date(iso))
  return `${p.m}月${p.d}日 ${p.hh}:${p.mm}`
}

/** 「9月28日(月)」 */
export function formatDateLabel(iso: string): string {
  const p = jstParts(new Date(iso))
  return `${p.m}月${p.d}日(${p.wd})`
}

export function formatFullDate(iso: string): string {
  const p = jstParts(new Date(iso))
  return `${p.y}年${p.m}月${p.d}日`
}

/** トークの日付区切り：「今日」「昨日」「9月28日(月)」 */
export function formatDaySeparator(iso: string, now = new Date()): string {
  const key = jstDateKey(iso)
  if (key === jstDateKey(now)) return '今日'
  if (key === jstDateKey(new Date(now.getTime() - 86400000))) return '昨日'
  return formatDateLabel(iso)
}

/** トークリストの時刻：今日は時刻、昨日は「昨日」、それ以前は「9/28」 */
export function formatListTime(iso: string, now = new Date()): string {
  const key = jstDateKey(iso)
  if (key === jstDateKey(now)) return formatTime(iso)
  if (key === jstDateKey(new Date(now.getTime() - 86400000))) return '昨日'
  const p = jstParts(new Date(iso))
  return `${p.m}/${p.d}`
}

export function formatRelative(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime())
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'たった今'
  if (min < 60) return `${min}分前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}時間前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}日前`
  return formatFullDate(iso)
}

/** 1,000 以上は「1.2k」 */
export function formatCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10000) return `${(Math.floor(n / 100) / 10).toFixed(1).replace(/\.0$/, '')}k`
  return `${Math.floor(n / 1000)}k`
}

export function formatNumber(n: number): string {
  return n.toLocaleString('ja-JP')
}

function yen(n: number): string {
  if (n >= 10000 && n % 10000 === 0) return `${n / 10000}万`
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}万`
  return n.toLocaleString('ja-JP')
}

/** 参考価格帯「5万〜10万円」 */
export function formatPriceRange(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null
  if (min != null && max != null) return `${yen(min)}〜${yen(max)}円`
  if (min != null) return `${yen(min)}円〜`
  return `〜${yen(max!)}円`
}

/** 平均返信時間「3時間以内」 */
export function formatReplyTime(ms: number | null): string | null {
  if (ms == null) return null
  const h = ms / 3600000
  if (h < 1) return '1時間以内'
  if (h < 24) return `${Math.ceil(h)}時間以内`
  return `${Math.ceil(h / 24)}日以内`
}

/** 無料枠の表記（500MB、5GB など）に合わせて 1000 単位で表示する */
export function formatBytes(n: number): string {
  if (n < 1e3) return `${n}B`
  if (n < 1e6) return `${(n / 1e3).toFixed(0)}KB`
  if (n < 1e9) return `${(n / 1e6).toFixed(1)}MB`
  return `${(n / 1e9).toFixed(2)}GB`
}
