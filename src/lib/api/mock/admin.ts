/**
 * 10章 運営コンソール。すべての操作は requireAdmin() でロールを確かめ、audit() で監査ログに残す。
 * 本番は service_role を使う Edge Function `admin-*` と、運営ロールを確かめる RLS で実装する。
 */
import { ApiError } from '../errors'
import { db, delay, done, requireAdmin, profileOf, audit, notify, adminRoleOf } from './core'
import { nowIso, uuid } from '../../ids'
import { matchesSearch, normalizeEmail, normalizeSearch } from '../../normalize'
import { activeRestrictions, isActiveRestriction, RESTRICTION_INFO, restrictionMessage } from '../../restrictions'
import { jstDateKey, formatDateTime } from '../../format'
import { LIMITS, OFFICIAL_USER_ID } from '../../constants'
import { deliverBroadcast, deliverDigest, normalBroadcastsToday, officialRoomOf, officialSay, segmentUsers } from './official'
import { runNewsPipeline } from './newsPipeline'
import { USAGE_LIMITS, toMeters, type Meter, type UserState } from '../shared'

export type { Meter, UserState } from '../shared'
export { USAGE_LIMITS }
import { nextMessageId } from '../../mock/db'
import type {
  AdminRole,
  AppSettings,
  Banner,
  Broadcast,
  Bubble,
  DupSuspicion,
  Master,
  NewsSource,
  Profile,
  Report,
  ReportStatus,
  Restriction,
  RestrictionKind,
  SegmentQuery,
  UsageMetric,
  Work,
} from '../../types'

function userState(p: Profile): UserState {
  if (p.status === 'banned') return 'banned'
  if (p.status === 'frozen') return 'frozen'
  if (p.status === 'leaving') return 'leaving'
  return activeRestrictions(db().restrictions.filter((r) => r.userId === p.id)).some((r) => r.kind !== 'warning') ? 'restricted' : 'normal'
}

function maskEmail(e: string): string {
  const [l, d] = e.split('@')
  return `${l.slice(0, 2)}***@${d}`
}

export const admin = {
  // ---------- ダッシュボード（A-02 / ZS-ADM-23） ----------
  async dashboard() {
    requireAdmin('dashboard')
    const d = db()
    const now = Date.now()
    const users = d.profiles.filter((p) => !p.isOfficial && !p.deletedAt)
    const within = (iso: string, days: number) => now - new Date(iso).getTime() < days * 86400_000
    const series = (days: number, f: (dayStart: number, dayEnd: number) => number) =>
      Array.from({ length: days }, (_, i) => {
        const end = now - (days - 1 - i) * 86400_000
        return f(end - 86400_000, end)
      })
    const msgsIn = (s: number, e: number) =>
      d.messages.filter((m) => {
        const t = new Date(m.createdAt).getTime()
        return t >= s && t < e
      }).length
    const worksIn = (s: number, e: number) =>
      d.works.filter((w) => w.publishedAt && new Date(w.publishedAt).getTime() >= s && new Date(w.publishedAt).getTime() < e).length
    const inqIn = (s: number, e: number) =>
      d.inquiries.filter((x) => {
        const t = new Date(x.createdAt).getTime()
        return t >= s && t < e
      }).length
    const regIn = (s: number, e: number) =>
      users.filter((u) => {
        const t = new Date(u.createdAt).getTime()
        return t >= s && t < e
      }).length
    const openReports = d.reports.filter((r) => r.status === 'open' || r.status === 'in_progress')
    const dau = users.filter((u) => within(u.lastLoginAt, 1)).length
    return delay({
      dau,
      wau: users.filter((u) => within(u.lastLoginAt, 7)).length,
      mau: users.filter((u) => within(u.lastLoginAt, 30)).length,
      totalUsers: users.length,
      // 前週比を出すため14日分（前半7日＝前週、後半7日＝今週）
      newUsers: series(14, regIn),
      messages: series(14, msgsIn),
      newWorks: series(14, worksIn),
      inquiries: series(14, inqIn),
      registrations30: series(30, (_s, e) => users.filter((u) => new Date(u.createdAt).getTime() < e).length),
      active30: series(30, (_s, e) => Math.max(1, Math.round(dau * (0.7 + 0.3 * Math.sin(e / 86400_000))))),
      openReports: openReports.length,
      overdueReports: openReports.filter((r) => now - new Date(r.createdAt).getTime() > 86400_000).length,
      pendingBroadcasts: d.broadcasts.filter((b) => b.status === 'pending').length,
      scheduledBroadcasts: d.broadcasts.filter((b) => b.status === 'scheduled'),
      newsToday: d.newsDigests.find((g) => g.date === jstDateKey(new Date())) ?? null,
      dupOpen: d.dupSuspicions.filter((s) => s.status === 'open').length,
      appealsOpen: d.appeals.filter((a) => a.status === 'open').length,
      failingSources: d.newsSources.filter((s) => s.enabled && s.failureCount > 0),
      kpi: {
        postRate: users.length ? users.filter((u) => d.works.some((w) => w.ownerId === u.id && w.visibility === 'public')).length / users.length : 0,
        chatActivity: dau ? Math.round(msgsIn(now - 86400_000, now) / dau) : 0,
      },
    })
  },

  /** ZS-ADM-24 無料枠モニター（70%で注意、90%で警告。直近14日の増え方から到達予測日） */
  async usage(): Promise<Meter[]> {
    requireAdmin('dashboard')
    return delay(toMeters(db().usageSnapshots))
  },

  /** デモ用：使用量を書き換えて逼迫状態を確認する */
  async simulateUsage(metric: UsageMetric, pct: number): Promise<void> {
    const { user } = requireAdmin('system')
    const d = db()
    const today = jstDateKey(new Date())
    const row = d.usageSnapshots.find((s) => s.metric === metric && s.date === today)
    const value = Math.round(USAGE_LIMITS[metric].limit * pct)
    if (row) row.value = value
    else d.usageSnapshots.push({ date: today, metric, value })
    // 15.1 無料枠の逼迫：90%を超えたら重い機能だけ止める
    const over = Object.keys(USAGE_LIMITS).some((m) => {
      const r = d.usageSnapshots.filter((s) => s.metric === m).sort((a, b) => (a.date < b.date ? 1 : -1))[0]
      return r && r.value / USAGE_LIMITS[m as UsageMetric].limit >= 0.9
    })
    d.settings.heavyFeaturesPaused = over
    audit(user.id, 'usage.simulate', 'usage', metric, null, { pct })
    return done(undefined)
  },

  // ---------- ユーザー（A-03 / A-04） ----------
  async searchUsers(q: string, state?: UserState | 'all'): Promise<{ profile: Profile; state: UserState; email: string }[]> {
    const { role } = requireAdmin('users')
    const d = db()
    const res = d.profiles
      .filter((p) => !p.isOfficial)
      .map((p) => {
        const email = d.identityKeys.find((k) => k.userId === p.id && k.kind === 'email')?.value ?? ''
        return { profile: p, state: userState(p), email: role === 'viewer' ? maskEmail(email) : email }
      })
      .filter((x) => !q || matchesSearch(`${x.profile.displayName} ${x.profile.handle} ${x.email} ${x.profile.id}`, q) || x.email === normalizeEmail(q))
      .filter((x) => !state || state === 'all' || x.state === state)
      .sort((a, b) => (a.profile.createdAt < b.profile.createdAt ? 1 : -1))
    return delay(res)
  },

  async userDetail(id: string) {
    const { role } = requireAdmin('users')
    const d = db()
    const p = profileOf(id)
    if (!p) throw new ApiError('not_found', 'ユーザーが見つかりません')
    const emails = d.identityKeys.filter((k) => k.userId === id).map((k) => ({ kind: k.kind, value: role === 'viewer' ? maskEmail(k.value) : k.value }))
    const devices = d.deviceHashes.filter((x) => x.userId === id)
    const sameDevice = devices.flatMap((dv) => d.deviceHashes.filter((x) => x.deviceHash === dv.deviceHash && x.userId !== id).map((x) => profileOf(x.userId)!))
    // メッセージ本文は表示しない（ZS-ADM-11）。件数だけ
    return delay({
      profile: p,
      state: userState(p),
      identities: emails,
      works: d.works.filter((w) => w.ownerId === id),
      stats: {
        messagesSent: d.messages.filter((m) => m.senderId === id).length,
        likesGiven: d.likes.filter((l) => l.userId === id).length,
        likesReceived: d.works.filter((w) => w.ownerId === id).reduce((n, w) => n + w.likeCount, 0),
        friends: d.friendships.filter((f) => f.userId === id).length,
      },
      restrictions: d.restrictions.filter((r) => r.userId === id).sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1)),
      reportsAbout: d.reports.filter((r) => r.targetId === id || (r.targetType === 'work' && d.works.find((w) => w.id === r.targetId)?.ownerId === id)),
      reportsBy: d.reports.filter((r) => r.reporterId === id).length,
      appeals: d.appeals.filter((a) => a.userId === id),
      devices,
      sameDevice: [...new Map(sameDevice.filter(Boolean).map((x) => [x.id, x])).values()],
      adminRole: adminRoleOf(id),
    })
  },

  /** ZS-ADM-01/05/06 利用制限の実行（一括可）。公式アカウントから本人に知らせる */
  async restrict(input: {
    userIds: string[]
    kind: RestrictionKind
    durationMs: number | null
    until?: string | null
    reasonCategory: string
    userMessage: string
    internalNote: string
  }): Promise<string[]> {
    const { user } = requireAdmin(input.kind === 'ban' || input.kind === 'freeze' ? 'ban' : 'restrict')
    if (input.userIds.length > 1) requireAdmin('restrict')
    const d = db()
    if (!input.reasonCategory) throw new ApiError('invalid', '理由カテゴリを選んでください')
    const start = nowIso()
    const endsAt = input.until ? new Date(input.until).toISOString() : input.durationMs ? new Date(Date.now() + input.durationMs).toISOString() : null
    if (input.kind === 'warning' || input.kind === 'ban') {
      /* 警告は期間なし、永久停止は無期限 */
    }
    const ids: string[] = []
    for (const uid of input.userIds) {
      const p = profileOf(uid)
      if (!p || p.isOfficial) continue
      if (d.adminMembers.some((m) => m.userId === uid && m.role === 'owner')) throw new ApiError('forbidden', 'オーナーには制限をかけられません')
      const r: Restriction = {
        id: uuid(),
        userId: uid,
        kind: input.kind,
        startsAt: start,
        endsAt: input.kind === 'warning' ? start : input.kind === 'ban' ? null : endsAt,
        reasonCategory: input.reasonCategory,
        userMessage: input.userMessage,
        internalNote: input.internalNote,
        createdBy: user.id,
        liftedAt: null,
      }
      d.restrictions.push(r)
      ids.push(r.id)
      const before = { status: p.status }
      if (input.kind === 'freeze') p.status = 'frozen'
      if (input.kind === 'ban') {
        p.status = 'banned'
        // 同じメールアドレスと認証IDでの再登録を止める
        for (const k of d.identityKeys.filter((k) => k.userId === uid)) if (!d.bannedIdentities.includes(k.value)) d.bannedIdentities.push(k.value)
      }
      const text =
        input.kind === 'warning'
          ? `【警告】${input.userMessage || '利用規約に反する行為が確認されました。今後同様の行為があった場合、利用を制限することがあります。'}`
          : `【${RESTRICTION_INFO[input.kind].label}】${restrictionMessage(r)}\n理由：${input.reasonCategory}${input.userMessage ? `\n${input.userMessage}` : ''}\n異議がある場合は、設定 > 利用制限 から申し立てができます。`
      officialSay(uid, text, { important: true })
      audit(user.id, `restriction.create.${input.kind}`, 'user', uid, before, { restrictionId: r.id, kind: r.kind, endsAt: r.endsAt, reason: r.reasonCategory })
    }
    return done(ids)
  },

  /** 実行直後の「元に戻す」（10秒以内・永久停止は対象外） */
  async undoRestrictions(ids: string[]): Promise<void> {
    const { user } = requireAdmin('restrict')
    const d = db()
    for (const id of ids) {
      const r = d.restrictions.find((x) => x.id === id)
      if (!r || r.kind === 'ban') continue
      if (Date.now() - new Date(r.startsAt).getTime() > 15_000) throw new ApiError('invalid', '元に戻せる時間を過ぎました。解除を使ってください')
      d.restrictions = d.restrictions.filter((x) => x.id !== id)
      const p = profileOf(r.userId)
      if (p && r.kind === 'freeze') p.status = 'active'
      officialSay(r.userId, '先ほどの利用制限のお知らせは取り消されました。', { important: true })
      audit(user.id, 'restriction.undo', 'user', r.userId, { restrictionId: id }, null)
    }
    return done(undefined)
  },

  async liftRestriction(id: string, note: string): Promise<void> {
    const r = db().restrictions.find((x) => x.id === id)
    if (!r) throw new ApiError('not_found', '制限が見つかりません')
    const { user } = requireAdmin(r.kind === 'ban' || r.kind === 'freeze' ? 'ban' : 'restrict')
    r.liftedAt = nowIso()
    const p = profileOf(r.userId)
    if (p && (r.kind === 'freeze' || r.kind === 'ban')) {
      p.status = 'active'
      const d = db()
      const keys = d.identityKeys.filter((k) => k.userId === r.userId).map((k) => k.value)
      d.bannedIdentities = d.bannedIdentities.filter((v) => !keys.includes(v))
    }
    officialSay(r.userId, `${RESTRICTION_INFO[r.kind].label}が解除されました`, { important: true })
    audit(user.id, 'restriction.lift', 'user', r.userId, { restrictionId: id }, { note })
    return done(undefined)
  },

  // ---------- 異議申し立て（ZS-ADM-07） ----------
  async appeals() {
    requireAdmin('restrict')
    const d = db()
    return delay(d.appeals.map((a) => ({ appeal: a, user: profileOf(a.userId)!, restriction: d.restrictions.find((r) => r.id === a.restrictionId) })))
  },
  async decideAppeal(id: string, decision: 'reviewing' | 'lifted' | 'kept', result: string): Promise<void> {
    const { user } = requireAdmin('restrict')
    const d = db()
    const a = d.appeals.find((x) => x.id === id)
    if (!a) throw new ApiError('not_found', '申し立てが見つかりません')
    a.status = decision
    a.decidedBy = user.id
    a.result = result
    if (decision === 'lifted') await admin.liftRestriction(a.restrictionId, `異議申し立てにより解除：${result}`)
    if (decision !== 'reviewing')
      officialSay(
        a.userId,
        decision === 'lifted' ? '異議申し立てを確認し、制限を解除しました。' : `異議申し立てを確認しましたが、制限を維持します。${result ? `\n${result}` : ''}`,
        { important: true },
      )
    audit(user.id, `appeal.${decision}`, 'appeal', id, null, { result })
    return done(undefined)
  },

  // ---------- 重複の疑い（ZS-ONE-04 / ZS-ADM-12） ----------
  async dupSuspicions(): Promise<(DupSuspicion & { users: Profile[] })[]> {
    requireAdmin('users')
    return delay(db().dupSuspicions.map((s) => ({ ...s, users: s.userIds.map((id) => profileOf(id)!).filter(Boolean) })))
  },
  async decideDup(id: string, status: 'ok' | 'confirm' | 'suspended', decision: string): Promise<void> {
    const { user } = requireAdmin('restrict')
    const s = db().dupSuspicions.find((x) => x.id === id)
    if (!s) throw new ApiError('not_found', '見つかりません')
    s.status = status
    s.decision = decision
    s.decidedBy = user.id
    if (status === 'confirm')
      for (const uid of s.userIds)
        officialSay(
          uid,
          '複数のアカウントをお持ちでないか確認させてください。zenospace は1人1アカウントでのご利用をお願いしています。このトークにご返信ください。',
          { important: true },
        )
    audit(user.id, `dup.${status}`, 'dup_suspicion', id, null, { decision })
    return done(undefined)
  },

  // ---------- 通報（A-05 / ZS-ADM-13〜16） ----------
  async reports(status: ReportStatus | 'all' = 'all') {
    requireAdmin('reports')
    const d = db()
    return delay(
      d.reports
        .filter((r) => status === 'all' || r.status === status)
        .map((r) => ({
          report: r,
          reporter: profileOf(r.reporterId),
          target: describeTarget(r),
          pastCount: d.reports.filter((x) => x.targetId === r.targetId && x.id !== r.id).length,
        })),
    )
  },
  async updateReport(id: string, patch: { status?: ReportStatus; assigneeId?: string | null }): Promise<void> {
    const { user } = requireAdmin('reports')
    const r = db().reports.find((x) => x.id === id)
    if (!r) throw new ApiError('not_found', '通報が見つかりません')
    const before = { status: r.status, assigneeId: r.assigneeId }
    Object.assign(r, patch)
    r.firstActionAt ??= nowIso()
    if (patch.status === 'resolved' || patch.status === 'rejected') {
      r.resolvedAt = nowIso()
      // 通報者には「対応しました」とだけ知らせる（措置の詳細は伝えない）
      if (patch.status === 'resolved')
        notify(r.reporterId, 'important', { target: '/notifications', text: 'ご報告いただいた内容を確認し、対応しました。ご協力ありがとうございます' })
    }
    audit(user.id, 'report.update', 'report', id, before, patch)
    return done(undefined)
  },

  // ---------- 作品（A-06 / ZS-ADM-17） ----------
  async works(q: string, filter: 'all' | 'hidden' | 'pickup' = 'all'): Promise<{ work: Work; owner: Profile; pickup: boolean; reports: number }[]> {
    requireAdmin('users')
    const d = db()
    return delay(
      d.works
        .filter((w) => w.visibility !== 'draft' && w.status !== 'trashed')
        .filter((w) => !q || matchesSearch(`${w.title} ${profileOf(w.ownerId)?.displayName}`, q))
        .filter((w) => filter === 'all' || (filter === 'hidden' ? w.status === 'hidden' : d.pickups.includes(w.id)))
        .map((w) => ({ work: w, owner: profileOf(w.ownerId)!, pickup: d.pickups.includes(w.id), reports: d.reports.filter((r) => r.targetId === w.id).length }))
        .sort((a, b) => ((a.work.publishedAt ?? '') < (b.work.publishedAt ?? '') ? 1 : -1)),
    )
  },
  async setWorkHidden(id: string, hidden: boolean, reason: string): Promise<void> {
    const { user } = requireAdmin('hideWork')
    const w = db().works.find((x) => x.id === id)
    if (!w) throw new ApiError('not_found', '作品が見つかりません')
    const before = { status: w.status }
    w.status = hidden ? 'hidden' : 'active'
    w.hiddenReason = hidden ? reason || '運営の判断により非公開にしました' : null
    officialSay(w.ownerId, hidden ? `作品「${w.title}」を非公開にしました。理由：${w.hiddenReason}` : `作品「${w.title}」の非公開を解除しました。`, {
      important: true,
    })
    audit(user.id, hidden ? 'work.hide' : 'work.unhide', 'work', id, before, { status: w.status, reason })
    return done(undefined)
  },
  async setPickup(id: string, on: boolean): Promise<void> {
    const { user } = requireAdmin('pickup')
    const d = db()
    d.pickups = on ? [...new Set([...d.pickups, id])] : d.pickups.filter((x) => x !== id)
    audit(user.id, on ? 'pickup.add' : 'pickup.remove', 'work', id, null, null)
    return done(undefined)
  },

  // ---------- 一斉配信（A-07〜A-09 / ZS-BC） ----------
  async broadcasts(): Promise<Broadcast[]> {
    requireAdmin('broadcastCreate')
    return delay([...db().broadcasts].filter((b) => b.kind !== 'news').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)))
  },
  async broadcast(id: string): Promise<Broadcast | null> {
    requireAdmin('broadcastCreate')
    return delay(db().broadcasts.find((b) => b.id === id) ?? null)
  },
  async estimateAudience(audience: Broadcast['audience'], q: SegmentQuery | null): Promise<number> {
    return delay(segmentUsers(q, audience).length, 0)
  },
  async saveBroadcast(input: Partial<Broadcast> & { id?: string }): Promise<Broadcast> {
    const { user } = requireAdmin('broadcastCreate')
    const d = db()
    if (input.bubbles && input.bubbles.length > LIMITS.broadcastBubbles) throw new ApiError('invalid', '吹き出しは5つまでです')
    let b = input.id ? d.broadcasts.find((x) => x.id === input.id) : undefined
    if (b && b.status === 'sent') throw new ApiError('invalid', '送信済みの配信は編集できません')
    if (!b) {
      b = {
        id: uuid(),
        title: '',
        status: 'draft',
        audience: 'all',
        segmentQuery: null,
        bubbles: [],
        pushText: '',
        scheduledAt: null,
        sentAt: null,
        canceledAt: null,
        targetCount: 0,
        pushDelivered: 0,
        createdBy: user.id,
        approvedBy: null,
        createdAt: nowIso(),
        kind: 'broadcast',
      }
      d.broadcasts.push(b)
    }
    const { id: _id, ...rest } = input
    void _id
    Object.assign(b, rest)
    b.targetCount = segmentUsers(b.segmentQuery, b.audience).length
    audit(user.id, 'broadcast.save', 'broadcast', b.id, null, { title: b.title, status: b.status })
    return done(b)
  },
  /** ZS-BC-06 承認フロー：配信担当は承認依頼だけ */
  async requestApproval(id: string): Promise<void> {
    const { user } = requireAdmin('broadcastCreate')
    const b = db().broadcasts.find((x) => x.id === id)
    if (!b) throw new ApiError('not_found', '配信が見つかりません')
    validateBroadcast(b)
    b.status = 'pending'
    for (const m of db().adminMembers.filter((m) => m.role === 'owner' || m.role === 'admin'))
      notify(m.userId, 'important', { target: `/admin/broadcasts/${b.id}`, text: `配信「${b.title || '無題'}」の承認依頼が届きました` })
    audit(user.id, 'broadcast.request_approval', 'broadcast', id, null, null)
    return done(undefined)
  },
  /** 承認して送信（予約時刻があれば予約、なければ即時） */
  async approveAndSend(id: string): Promise<void> {
    const { user, role } = requireAdmin('broadcastCreate')
    const d = db()
    const b = d.broadcasts.find((x) => x.id === id)
    if (!b) throw new ApiError('not_found', '配信が見つかりません')
    const needsApproval = d.settings.broadcastApprovalRequired && b.audience !== 'test'
    if (needsApproval && role !== 'owner' && role !== 'admin') throw new ApiError('forbidden', '承認は管理者以上が行います。承認依頼を送ってください')
    validateBroadcast(b)
    if (
      b.kind === 'broadcast' &&
      b.audience !== 'test' &&
      normalBroadcastsToday() >= d.settings.broadcastDailyLimit &&
      !(b.scheduledAt && new Date(b.scheduledAt) > new Date())
    )
      throw new ApiError('invalid', `通常配信は1日${d.settings.broadcastDailyLimit}通までです`)
    b.approvedBy = user.id
    if (b.scheduledAt && new Date(b.scheduledAt) > new Date()) {
      b.status = 'scheduled'
      audit(user.id, 'broadcast.schedule', 'broadcast', id, null, { scheduledAt: b.scheduledAt })
    } else {
      deliverBroadcast(b)
      audit(user.id, 'broadcast.send', 'broadcast', id, null, { targetCount: b.targetCount })
    }
    return done(undefined)
  },
  /** ZS-BC-05 テスト送信（運営メンバーだけへ） */
  async testSend(id: string): Promise<number> {
    const { user } = requireAdmin('broadcastCreate')
    const d = db()
    const src = d.broadcasts.find((x) => x.id === id)
    if (!src) throw new ApiError('not_found', '配信が見つかりません')
    validateBroadcast(src)
    const copy: Broadcast = {
      ...structuredClone(src),
      id: uuid(),
      title: `[テスト] ${src.title}`,
      audience: 'test',
      segmentQuery: null,
      status: 'draft',
      createdAt: nowIso(),
      scheduledAt: null,
    }
    d.broadcasts.push(copy)
    deliverBroadcast(copy)
    audit(user.id, 'broadcast.test', 'broadcast', id, null, { to: copy.targetCount })
    return done(copy.targetCount)
  },
  /** ZS-BC-07 送信後24時間以内の取り消し・予約の取り消し */
  async cancelBroadcast(id: string): Promise<void> {
    const { user } = requireAdmin('broadcastApprove')
    const b = db().broadcasts.find((x) => x.id === id)
    if (!b) throw new ApiError('not_found', '配信が見つかりません')
    if (b.status === 'sent' && Date.now() - new Date(b.sentAt!).getTime() > 86400_000)
      throw new ApiError('invalid', '送信から24時間を過ぎた配信は取り消せません')
    b.status = b.status === 'sent' ? 'sent' : 'draft'
    if (b.sentAt) b.canceledAt = nowIso()
    else b.scheduledAt = null
    audit(user.id, 'broadcast.cancel', 'broadcast', id, null, null)
    return done(undefined)
  },
  async deleteBroadcast(id: string): Promise<void> {
    const { user } = requireAdmin('broadcastCreate')
    const d = db()
    const b = d.broadcasts.find((x) => x.id === id)
    if (b?.status === 'sent') throw new ApiError('invalid', '送信済みの配信は削除できません')
    d.broadcasts = d.broadcasts.filter((x) => x.id !== id)
    audit(user.id, 'broadcast.delete', 'broadcast', id, null, null)
    return done(undefined)
  },
  /** ZS-BC-08 効果測定 */
  async broadcastReport(id: string) {
    requireAdmin('broadcastCreate')
    const d = db()
    const b = d.broadcasts.find((x) => x.id === id)
    if (!b) throw new ApiError('not_found', '配信が見つかりません')
    const ev = d.broadcastEvents.filter((e) => e.broadcastId === id)
    const reads = new Set(ev.filter((e) => e.kind === 'read').map((e) => e.userId)).size
    const clickers = new Set(ev.filter((e) => e.kind === 'click').map((e) => e.userId)).size
    const buttons = new Map<string, number>()
    for (const e of ev.filter((e) => e.kind === 'click')) buttons.set(e.buttonKey ?? '-', (buttons.get(e.buttonKey ?? '-') ?? 0) + 1)
    const labels = new Map<string, string>()
    for (const bubble of b.bubbles) {
      const cards = bubble.type === 'card' ? [bubble.card] : bubble.type === 'carousel' ? bubble.cards : []
      for (const c of cards) for (const btn of c.buttons ?? []) labels.set(btn.key, `${c.title}：${btn.label}`)
    }
    return delay({
      broadcast: b,
      target: b.targetCount,
      pushDelivered: b.pushDelivered,
      reads,
      clickers,
      openRate: b.targetCount ? reads / b.targetCount : 0,
      clickRate: b.targetCount ? clickers / b.targetCount : 0,
      buttons: [...buttons.entries()].map(([key, count]) => ({ key, label: labels.get(key) ?? key, count })),
    })
  },

  // ---------- バナー（A-12 / ZS-BC-10） ----------
  async banners(): Promise<Banner[]> {
    requireAdmin('broadcastCreate')
    return delay([...db().banners].sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1)))
  },
  async saveBanner(input: Omit<Banner, 'id'> & { id?: string }): Promise<void> {
    const { user } = requireAdmin('broadcastCreate')
    const d = db()
    if (!input.title.trim()) throw new ApiError('invalid', 'タイトルを入力してください')
    if (new Date(input.endsAt) <= new Date(input.startsAt)) throw new ApiError('invalid', '掲出終了は開始より後にしてください')
    if (input.id)
      Object.assign(
        d.banners.find((b) => b.id === input.id)!,
        input,
      )
    else d.banners.push({ ...input, id: uuid() })
    audit(user.id, 'banner.save', 'banner', input.id ?? 'new', null, input)
    return done(undefined)
  },
  async deleteBanner(id: string): Promise<void> {
    const { user } = requireAdmin('broadcastCreate')
    db().banners = db().banners.filter((b) => b.id !== id)
    audit(user.id, 'banner.delete', 'banner', id, null, null)
    return done(undefined)
  },

  // ---------- AIニュース（A-10 / ZS-NEWS） ----------
  async newsToday() {
    requireAdmin('news')
    const d = db()
    const date = jstDateKey(new Date())
    const digest = d.newsDigests.find((g) => g.date === date) ?? null
    const items = digest ? d.newsItems.filter((n) => n.digestId === digest.id) : []
    return delay({
      digest,
      selected: items.filter((n) => n.rank != null).sort((a, b) => a.rank! - b.rank!),
      candidates: items.filter((n) => n.rank == null).sort((a, b) => b.score - a.score),
      sources: d.newsSources,
      history: d.newsDigests
        .filter((g) => g.date !== date)
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .slice(0, 14),
      reactions: d.newsSources.map((s) => ({
        source: s,
        useful: d.newsReactions.filter((r) => r.kind === 'useful' && d.newsItems.find((n) => n.id === r.itemId)?.sourceId === s.id).length,
      })),
    })
  },
  async runNews(opts: { failSummaryForDemo?: boolean } = {}): Promise<void> {
    const { user } = requireAdmin('news')
    const dg = runNewsPipeline(opts)
    if (db().settings.news.mode === 'auto' && dg.status === 'pending') {
      dg.approvedBy = user.id
      deliverDigest(dg, user.id)
    }
    audit(user.id, 'news.run', 'news_digest', dg.id, null, { status: dg.status })
    return done(undefined)
  },
  async updateNewsItem(id: string, patch: { titleJa?: string; summaryJa?: string }): Promise<void> {
    const { user } = requireAdmin('news')
    const n = db().newsItems.find((x) => x.id === id)
    if (!n) throw new ApiError('not_found', '記事が見つかりません')
    if (patch.summaryJa && patch.summaryJa.length > 120) throw new ApiError('invalid', '要約は120文字以内にしてください')
    Object.assign(n, patch)
    audit(user.id, 'news.edit', 'news_item', id, null, patch)
    return done(undefined)
  },
  async reorderNews(digestId: string, ids: string[]): Promise<void> {
    requireAdmin('news')
    const d = db()
    for (const n of d.newsItems.filter((x) => x.digestId === digestId)) n.rank = ids.includes(n.id) ? ids.indexOf(n.id) + 1 : null
    return done(undefined)
  },
  async replaceNews(selectedId: string, candidateId: string): Promise<void> {
    requireAdmin('news')
    const d = db()
    const a = d.newsItems.find((x) => x.id === selectedId)
    const b = d.newsItems.find((x) => x.id === candidateId)
    if (!a || !b) throw new ApiError('not_found', '記事が見つかりません')
    b.rank = a.rank
    a.rank = null
    return done(undefined)
  },
  /** 「承認して配信」：予約時刻より前なら予約、過ぎていれば即時（14.11） */
  async approveNews(digestId: string): Promise<'sent' | 'approved'> {
    const { user } = requireAdmin('news')
    const d = db()
    const dg = d.newsDigests.find((x) => x.id === digestId)
    if (!dg) throw new ApiError('not_found', 'ダイジェストが見つかりません')
    dg.approvedBy = user.id
    const [hh, mm] = d.settings.news.time.split(':').map(Number)
    const sendAt = new Date(`${dg.date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+09:00`)
    let res: 'sent' | 'approved'
    if (sendAt > new Date()) {
      dg.status = 'approved'
      res = 'approved'
    } else {
      deliverDigest(dg, user.id)
      res = 'sent'
    }
    audit(user.id, 'news.approve', 'news_digest', digestId, null, { result: res })
    return done(res)
  },
  async saveSource(input: Omit<NewsSource, 'id' | 'lastSuccessAt' | 'failureCount'> & { id?: string }): Promise<void> {
    const { user } = requireAdmin('news')
    const d = db()
    try {
      new URL(input.feedUrl)
    } catch {
      throw new ApiError('invalid', 'フィードURLの形式が正しくありません')
    }
    if (input.id)
      Object.assign(
        d.newsSources.find((s) => s.id === input.id)!,
        input,
      )
    else d.newsSources.push({ ...input, id: uuid(), lastSuccessAt: null, failureCount: 0 })
    audit(user.id, 'news.source.save', 'news_source', input.id ?? 'new', null, input)
    return done(undefined)
  },
  async deleteSource(id: string): Promise<void> {
    const { user } = requireAdmin('news')
    db().newsSources = db().newsSources.filter((s) => s.id !== id)
    audit(user.id, 'news.source.delete', 'news_source', id, null, null)
    return done(undefined)
  },

  // ---------- サポート受信箱（A-11 / ZS-ADM-20） ----------
  async supportThreads() {
    requireAdmin('support')
    const d = db()
    return delay(
      d.supportThreads
        .map((t) => {
          const msgs = d.messages.filter((m) => m.roomId === t.roomId).sort((a, b) => a.id - b.id)
          return { thread: t, user: profileOf(t.userId)!, last: msgs[msgs.length - 1] }
        })
        .sort((a, b) => (a.thread.lastUserMessageAt < b.thread.lastUserMessageAt ? 1 : -1)),
    )
  },
  async supportMessages(roomId: string) {
    requireAdmin('support')
    // 公式アカウント宛てのメッセージは運営が閲覧できる（19.1 の例外）
    return delay(
      db()
        .messages.filter((m) => m.roomId === roomId)
        .sort((a, b) => a.id - b.id),
    )
  },
  async supportReply(roomId: string, body: string, signName?: string): Promise<void> {
    const { user } = requireAdmin('support')
    const d = db()
    const t = d.supportThreads.find((x) => x.roomId === roomId)
    if (!t) throw new ApiError('not_found', 'スレッドが見つかりません')
    if (!body.trim()) throw new ApiError('invalid', '返信を入力してください')
    const room = d.rooms.find((r) => r.id === roomId)!
    const at = nowIso()
    d.messages.push({
      id: nextMessageId(),
      roomId,
      senderId: OFFICIAL_USER_ID,
      kind: 'text',
      body,
      replyToId: null,
      meta: { fromAdmin: { name: signName } },
      clientId: uuid(),
      createdAt: at,
      unsentAt: null,
    })
    room.lastMessageAt = at
    room.lastMessagePreview = body
    t.status = 'pending'
    t.assigneeId ??= user.id
    notify(t.userId, 'message', { actorId: OFFICIAL_USER_ID, target: `/talk/${roomId}`, text: `運営チーム「${body.slice(0, 40)}」` })
    audit(user.id, 'support.reply', 'support_thread', roomId, null, null)
    return done(undefined)
  },
  async updateSupport(roomId: string, patch: { status?: 'open' | 'pending' | 'closed'; assigneeId?: string | null }): Promise<void> {
    requireAdmin('support')
    const t = db().supportThreads.find((x) => x.roomId === roomId)
    if (t) Object.assign(t, patch)
    return done(undefined)
  },
  supportTemplates() {
    return db().supportTemplates
  },

  // ---------- マスタ（A-13 / ZS-ADM-21） ----------
  async saveMaster(kind: 'categories' | 'techs', input: { id?: string; name: string }): Promise<void> {
    const { user } = requireAdmin('masters')
    const d = db()
    const list: Master[] = d[kind]
    if (!input.name.trim()) throw new ApiError('invalid', '名前を入力してください')
    if (list.some((m) => m.normalizedName === normalizeSearch(input.name) && m.id !== input.id)) throw new ApiError('conflict', '同じ名前がすでにあります')
    if (input.id) {
      const m = list.find((x) => x.id === input.id)!
      m.name = input.name.trim()
      m.normalizedName = normalizeSearch(input.name)
    } else list.push({ id: uuid(), name: input.name.trim(), normalizedName: normalizeSearch(input.name), sortOrder: list.length })
    audit(user.id, `master.${kind}.save`, kind, input.id ?? 'new', null, input)
    return done(undefined)
  },
  async moveMaster(kind: 'categories' | 'techs', id: string, dir: -1 | 1): Promise<void> {
    requireAdmin('masters')
    const list = [...db()[kind]].sort((a, b) => a.sortOrder - b.sortOrder)
    const i = list.findIndex((m) => m.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    ;[list[i].sortOrder, list[j].sortOrder] = [list[j].sortOrder, list[i].sortOrder]
    return done(undefined)
  },
  async deleteMaster(kind: 'categories' | 'techs', id: string): Promise<void> {
    const { user } = requireAdmin('masters')
    const d = db()
    const used = kind === 'categories' ? d.works.some((w) => w.categoryId === id) : d.works.some((w) => w.techIds.includes(id))
    if (used) throw new ApiError('conflict', '作品で使われているため削除できません')
    d[kind] = d[kind].filter((m) => m.id !== id)
    audit(user.id, `master.${kind}.delete`, kind, id, null, null)
    return done(undefined)
  },
  /** タグの統合：from を to にまとめる */
  async mergeTags(from: string, to: string): Promise<number> {
    const { user } = requireAdmin('masters')
    let n = 0
    for (const w of db().works) {
      if (w.tags.includes(from)) {
        w.tags = [...new Set(w.tags.map((t) => (t === from ? to : t)))]
        n++
      }
    }
    audit(user.id, 'master.tags.merge', 'tag', from, null, { to, works: n })
    return done(n)
  },
  async saveNgWord(word: string, severity: 'warn' | 'block'): Promise<void> {
    const { user } = requireAdmin('masters')
    if (!word.trim()) throw new ApiError('invalid', 'NGワードを入力してください')
    db().ngWords.push({ id: uuid(), word: word.trim(), severity })
    audit(user.id, 'master.ngword.add', 'ng_word', word, null, { severity })
    return done(undefined)
  },
  async deleteNgWord(id: string): Promise<void> {
    const { user } = requireAdmin('masters')
    db().ngWords = db().ngWords.filter((w) => w.id !== id)
    audit(user.id, 'master.ngword.delete', 'ng_word', id, null, null)
    return done(undefined)
  },
  async saveTemplate(input: { id?: string; title: string; body: string }): Promise<void> {
    requireAdmin('masters')
    const d = db()
    if (input.id)
      Object.assign(
        d.supportTemplates.find((t) => t.id === input.id)!,
        input,
      )
    else d.supportTemplates.push({ id: uuid(), title: input.title, body: input.body })
    return done(undefined)
  },

  // ---------- 運営メンバー（A-14 / ZS-ADM-26） ----------
  async members() {
    requireAdmin('dashboard')
    return delay(db().adminMembers.map((m) => ({ member: m, profile: profileOf(m.userId)! })))
  },
  async setMemberRole(handle: string, role: AdminRole | null): Promise<void> {
    const { user } = requireAdmin('members')
    const d = db()
    const p = d.profiles.find((x) => x.handle === handle.replace(/^@/, ''))
    if (!p) throw new ApiError('not_found', 'ユーザーが見つかりません')
    if (p.id === user.id && role !== 'owner') throw new ApiError('forbidden', '自分のオーナー権限は外せません')
    const before = adminRoleOf(p.id)
    d.adminMembers = d.adminMembers.filter((m) => m.userId !== p.id)
    if (role) d.adminMembers.push({ userId: p.id, role, totpEnrolled: false })
    audit(user.id, role ? 'admin.role.set' : 'admin.role.remove', 'admin_member', p.id, { role: before }, { role })
    return done(undefined)
  },

  // ---------- 監査ログ（A-15 / ZS-ADM-25） ----------
  async auditLogs(q = '') {
    requireAdmin('audit')
    return delay(
      db()
        .auditLogs.filter((l) => !q || matchesSearch(`${l.action} ${l.targetType} ${l.targetId} ${profileOf(l.actorId)?.displayName}`, q))
        .map((l) => ({ log: l, actor: profileOf(l.actorId) })),
    )
  },
  async auditCsv(): Promise<string> {
    requireAdmin('audit')
    const esc = (v: unknown) => `"${String(typeof v === 'string' ? v : JSON.stringify(v ?? '')).replaceAll('"', '""')}"`
    const rows = db().auditLogs.map((l) =>
      [formatDateTime(l.createdAt), profileOf(l.actorId)?.handle ?? l.actorId, l.action, l.targetType, l.targetId, l.before, l.after].map(esc).join(','),
    )
    return delay(['日時(JST),操作者,操作,対象種別,対象ID,変更前,変更後', ...rows].join('\n'), 0)
  },

  // ---------- システム設定（A-16 / ZS-ADM-22） ----------
  settings(): AppSettings {
    return db().settings
  },
  async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    const isNewsOnly = Object.keys(patch).every((k) => k === 'news')
    const { user } = requireAdmin(isNewsOnly ? 'news' : 'system')
    const d = db()
    const before = structuredClone(d.settings)
    Object.assign(d.settings, patch)
    audit(user.id, 'settings.update', 'app_settings', Object.keys(patch).join(','), before, patch)
    return done(undefined)
  },

  /** 個人データの出力（オーナーのみ） */
  async exportUser(id: string): Promise<string> {
    requireAdmin('export')
    const d = db()
    return delay(
      JSON.stringify(
        {
          profile: profileOf(id),
          works: d.works.filter((w) => w.ownerId === id),
          likes: d.likes.filter((l) => l.userId === id),
          restrictions: d.restrictions.filter((r) => r.userId === id),
        },
        null,
        2,
      ),
      0,
    )
  },
}

function describeTarget(r: Report): { label: string; link: string | null; ownerId: string | null } {
  const d = db()
  if (r.targetType === 'user') {
    const p = profileOf(r.targetId)
    return { label: p ? `${p.displayName}（@${p.handle}）` : '退会したユーザー', link: p ? `/admin/users/${p.id}` : null, ownerId: p?.id ?? null }
  }
  if (r.targetType === 'work') {
    const w = d.works.find((x) => x.id === r.targetId)
    return { label: w ? `作品「${w.title}」` : '削除された作品', link: w ? `/works/${w.id}` : null, ownerId: w?.ownerId ?? null }
  }
  const m = d.messages.find((x) => String(x.id) === r.targetId)
  return { label: 'メッセージ', link: null, ownerId: m?.senderId ?? null }
}

function validateBroadcast(b: Broadcast) {
  if (!b.bubbles.length) throw new ApiError('invalid', '吹き出しを1つ以上追加してください')
  for (const bubble of b.bubbles as Bubble[]) {
    if (bubble.type === 'text' && !bubble.text.trim()) throw new ApiError('invalid', '空のテキスト吹き出しがあります')
    if (bubble.type === 'carousel' && bubble.cards.length > 10) throw new ApiError('invalid', 'カルーセルのカードは10枚までです')
    const cards = bubble.type === 'card' ? [bubble.card] : bubble.type === 'carousel' ? bubble.cards : []
    for (const c of cards) if ((c.buttons?.length ?? 0) > 3) throw new ApiError('invalid', 'カードのボタンは3つまでです')
  }
}

export { isActiveRestriction, officialRoomOf }
