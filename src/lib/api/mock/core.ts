import { db, commit } from '../../mock/db'
import { ApiError } from '../errors'
import { capabilities, type Capabilities } from '../../restrictions'
import type { AdminRole, AppNotification, NotificationKind, Profile } from '../../types'
import { uuid, nowIso } from '../../ids'
import { OFFICIAL_USER_ID } from '../../constants'

const SESSION_KEY = 'zenospace:session'
const ADMIN_SESSION_KEY = 'zenospace:admin-session'

const latency = Number(import.meta.env.VITE_MOCK_LATENCY ?? 120)

/** 通信の遅れを再現する（スケルトン表示などの確認用） */
export async function delay<T>(value: T, ms = latency): Promise<T> {
  if (ms <= 0) return value
  await new Promise((r) => setTimeout(r, ms * (0.5 + Math.random())))
  return value
}

export function sessionUserId(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}
export function setSession(userId: string | null) {
  try {
    if (userId) localStorage.setItem(SESSION_KEY, userId)
    else {
      localStorage.removeItem(SESSION_KEY)
      sessionStorage.removeItem(ADMIN_SESSION_KEY)
    }
  } catch {
    /* noop */
  }
}

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

export function currentUser(): Profile | null {
  const id = sessionUserId()
  if (!id) return null
  return db().profiles.find((p) => p.id === id && !p.deletedAt) ?? null
}

export function requireUser(): Profile {
  const u = currentUser()
  if (!u) throw new ApiError('unauthenticated', 'ログインしてください')
  if (u.status === 'frozen' || u.status === 'banned') throw new ApiError('restricted', 'このアカウントは利用できません')
  return u
}

export function capsOf(userId: string): Capabilities {
  return capabilities(db().restrictions.filter((r) => r.userId === userId))
}

export function requireCap(userId: string, cap: keyof Capabilities, message: string) {
  if (!capsOf(userId)[cap]) throw new ApiError('restricted', message)
}

export function profileOf(id: string): Profile | undefined {
  return db().profiles.find((p) => p.id === id)
}

export function isBlockedBetween(a: string, b: string): boolean {
  return db().blocks.some((x) => (x.blockerId === a && x.blockedId === b) || (x.blockerId === b && x.blockedId === a))
}

export function hasBlocked(blocker: string, blocked: string): boolean {
  return db().blocks.some((x) => x.blockerId === blocker && x.blockedId === blocked)
}

export function isFriend(userId: string, friendId: string): boolean {
  return db().friendships.some((f) => f.userId === userId && f.friendId === friendId)
}

/** 通知を作る。同じ種類・同じ対象の未読はまとめる（8.3 のまとめ方） */
export function notify(userId: string, kind: NotificationKind, input: { actorId?: string | null; target: string; text: string; group?: boolean }) {
  const d = db()
  if (userId === OFFICIAL_USER_ID) return
  const settings = d.userSettings.find((s) => s.userId === userId)
  if (settings && kind !== 'important' && settings.notify[kind] === false) return
  if (input.group) {
    const existing = d.notifications.find(
      (n) => n.userId === userId && n.kind === kind && n.target === input.target && !n.readAt && Date.now() - new Date(n.createdAt).getTime() < 3600_000,
    )
    if (existing) {
      existing.groupedCount += 1
      existing.text = input.text.replace('{n}', String(existing.groupedCount))
      existing.createdAt = nowIso()
      existing.actorId = input.actorId ?? existing.actorId
      return
    }
  }
  const n: AppNotification = {
    id: uuid(),
    userId,
    kind,
    actorId: input.actorId ?? null,
    target: input.target,
    text: input.text.replace('{n}', '1'),
    groupedCount: 1,
    readAt: null,
    createdAt: nowIso(),
  }
  d.notifications.unshift(n)
  pushToDevice(userId, n)
}

/** Web Push 送信の代わり。本番は Edge Function `push-send` が VAPID で送る */
function pushToDevice(userId: string, n: AppNotification) {
  if (sessionUserId() !== userId) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return
  const s = db().userSettings.find((x) => x.userId === userId)
  if (s?.quietHours.enabled && inQuietHours(s.quietHours.start, s.quietHours.end)) return
  try {
    void navigator.serviceWorker?.ready.then((reg) =>
      reg.showNotification('zenospace', { body: s?.hidePushBody ? '新しい通知があります' : n.text, tag: n.target, data: { url: n.target } }),
    )
  } catch {
    /* noop */
  }
}

export function inQuietHours(start: string, end: string, now = new Date()): boolean {
  const f = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const cur = f.format(now)
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end
}

export function audit(actorId: string, action: string, targetType: string, targetId: string, before: unknown, after: unknown) {
  db().auditLogs.unshift({ id: uuid(), actorId, action, targetType, targetId, before, after, createdAt: nowIso() })
}

export function adminRoleOf(userId: string): AdminRole | null {
  return db().adminMembers.find((m) => m.userId === userId)?.role ?? null
}

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

/** 運営操作の前提：ログイン＋運営ロール＋TOTP 済みセッション（30分で再認証） */
export function requireAdmin(perm: Permission): { user: Profile; role: AdminRole } {
  const user = requireUser()
  const role = adminRoleOf(user.id)
  const s = adminSession()
  if (!role || !s || s.userId !== user.id) throw new ApiError('forbidden', '運営コンソールにログインしてください')
  if (Date.now() - s.at > 30 * 60_000) {
    setAdminSession(null)
    throw new ApiError('forbidden', '30分間操作がなかったため、再認証してください')
  }
  setAdminSession(user.id) // 操作のたびに延長
  if (!can(role, perm)) throw new ApiError('forbidden', 'この操作の権限がありません')
  return { user, role }
}

export function done<T>(value: T): Promise<T> {
  commit()
  return delay(value)
}

export { db, commit }
