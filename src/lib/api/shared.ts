/**
 * モック実装と Supabase 実装の両方が使う定義（権限表・運営セッション・無料枠の上限など）。
 * どちらの実装にも依存しないので、画面から直接 import してよい。
 */
import type { AdminRole, UsageMetric } from '../types'

/** 3.2 運営ロールと権限 */
export const PERMISSIONS = {
  dashboard: ['owner', 'admin', 'moderator', 'publisher', 'viewer'],
  users: ['owner', 'admin', 'moderator', 'viewer'],
  restrict: ['owner', 'admin', 'moderator'],
  ban: ['owner', 'admin'],
  reports: ['owner', 'admin', 'moderator'],
  hideWork: ['owner', 'admin', 'moderator'],
  pickup: ['owner', 'admin', 'publisher'],
  broadcastCreate: ['owner', 'admin', 'publisher'],
  broadcastApprove: ['owner', 'admin'],
  news: ['owner', 'admin', 'publisher'],
  support: ['owner', 'admin', 'moderator', 'publisher'],
  masters: ['owner', 'admin'],
  members: ['owner'],
  system: ['owner'],
  audit: ['owner', 'admin'],
  export: ['owner'],
} satisfies Record<string, AdminRole[]>
export type Permission = keyof typeof PERMISSIONS

export function can(role: AdminRole | null, perm: Permission): boolean {
  return !!role && (PERMISSIONS[perm] as AdminRole[]).includes(role)
}

const ADMIN_SESSION_KEY = 'zenospace:admin-session'
/** 運営コンソールは30分操作がなければ再認証（3.2） */
export const ADMIN_IDLE_MS = 30 * 60_000

/** 運営コンソールのセッション（TOTP を確かめた時刻。タブを閉じると消える） */
export function adminSession(): { userId: string; at: number } | null {
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
export function setAdminSession(userId: string | null) {
  try {
    if (userId) sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ userId, at: Date.now() }))
    else sessionStorage.removeItem(ADMIN_SESSION_KEY)
  } catch {
    /* noop */
  }
}

/** 無料枠の上限（17.3） */
export const USAGE_LIMITS: Record<UsageMetric, { label: string; limit: number; unit: 'bytes' | 'count'; period: 'total' | 'month' | 'day' }> = {
  db_bytes: { label: 'DB容量（Supabase）', limit: 500e6, unit: 'bytes', period: 'total' },
  storage_bytes: { label: 'ストレージ（Supabase）', limit: 1e9, unit: 'bytes', period: 'total' },
  realtime_peak: { label: '同時接続のピーク', limit: 200, unit: 'count', period: 'total' },
  realtime_messages: { label: 'リアルタイム配信（月）', limit: 2e6, unit: 'count', period: 'month' },
  egress_bytes: { label: '転送量（月）', limit: 5e9, unit: 'bytes', period: 'month' },
  function_invocations: { label: '関数の実行回数（月）', limit: 5e5, unit: 'count', period: 'month' },
  worker_requests: { label: 'Workers リクエスト（日）', limit: 1e5, unit: 'count', period: 'day' },
  r2_bytes: { label: 'R2 保存容量', limit: 10e9, unit: 'bytes', period: 'total' },
}

export interface Meter {
  metric: UsageMetric
  label: string
  value: number
  limit: number
  pct: number
  unit: 'bytes' | 'count'
  projectedDate: string | null
  level: 'ok' | 'caution' | 'warning'
}

/** 使用量の記録から、上限に対する割合と到達予測日を求める（直近の増え方から） */
export function toMeters(rows: { date: string; metric: UsageMetric; value: number }[]): Meter[] {
  const out: Meter[] = []
  for (const [metric, info] of Object.entries(USAGE_LIMITS) as [UsageMetric, (typeof USAGE_LIMITS)[UsageMetric]][]) {
    const list = rows.filter((s) => s.metric === metric).sort((a, b) => (a.date < b.date ? -1 : 1))
    const last = list[list.length - 1]?.value ?? 0
    const first = list[0]?.value ?? last
    const perDay = list.length > 1 ? (last - first) / (list.length - 1) : 0
    const pct = last / info.limit
    let projectedDate: string | null = null
    if (perDay > 0 && pct < 1) {
      const days = Math.ceil((info.limit - last) / perDay)
      if (days < 365) projectedDate = new Date(Date.now() + days * 86400_000).toISOString()
    }
    out.push({
      metric,
      label: info.label,
      value: last,
      limit: info.limit,
      pct,
      unit: info.unit,
      projectedDate,
      level: pct >= 0.9 ? 'warning' : pct >= 0.7 ? 'caution' : 'ok',
    })
  }
  return out
}

export type UserState = 'normal' | 'restricted' | 'frozen' | 'banned' | 'leaving'

/** モック動作時のログイン画面に出すデモアカウント */
export const DEMO_ACCOUNTS = [
  { email: 'kura@example.com', label: 'くら（運営オーナー）' },
  { email: 'mio.design@gmail.com', label: 'みお（LP制作）' },
  { email: 'taku.dev@gmail.com', label: 'たく（エンジニア）' },
  { email: 'hana.illust@gmail.com', label: 'はな（イラスト）' },
]

/** 公式アカウントのトークに出す配信の吹き出しに振る仮のID（実メッセージと重ならない大きな数） */
export const BROADCAST_ID_BASE = 1_000_000_000
