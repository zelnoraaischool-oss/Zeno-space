/** 公式アカウントからの個別メッセージ（制限の通知・サポート返信など）と配信処理 */
import { db, notify, profileOf } from './core'
import { nextMessageId } from '../../mock/db'
import { uuid, nowIso } from '../../ids'
import { OFFICIAL_USER_ID } from '../../constants'
import type { Broadcast, NewsDigest, Profile, SegmentQuery } from '../../types'
import { jstDateKey } from '../../format'

export function officialRoomOf(userId: string): string | null {
  const d = db()
  const m = d.roomMembers.find((x) => x.userId === userId && d.rooms.find((r) => r.id === x.roomId)?.kind === 'official')
  return m?.roomId ?? null
}

export function officialSay(userId: string, text: string, opts: { adminName?: string; important?: boolean } = {}) {
  const d = db()
  const roomId = officialRoomOf(userId)
  if (!roomId) return
  const room = d.rooms.find((r) => r.id === roomId)!
  const at = nowIso()
  d.messages.push({
    id: nextMessageId(),
    roomId,
    senderId: OFFICIAL_USER_ID,
    kind: 'text',
    body: text,
    replyToId: null,
    meta: { fromAdmin: { name: opts.adminName } },
    clientId: uuid(),
    createdAt: at,
    unsentAt: null,
  })
  room.lastMessageAt = at
  room.lastMessagePreview = text
  if (opts.important) notify(userId, 'important', { actorId: OFFICIAL_USER_ID, target: `/talk/${roomId}`, text: text.slice(0, 60) })
}

/** セグメント条件に合うユーザー（ZS-BC-03） */
export function segmentUsers(q: SegmentQuery | null, audience: Broadcast['audience']): Profile[] {
  const d = db()
  const base = d.profiles.filter((p) => !p.isOfficial && !p.deletedAt && p.status !== 'banned')
  if (audience === 'test') return base.filter((p) => d.adminMembers.some((m) => m.userId === p.id))
  if (audience === 'all' || !q) return base
  return base.filter((p) => {
    if (q.registeredAfter && p.createdAt < q.registeredAfter) return false
    if (q.registeredBefore && p.createdAt > q.registeredBefore) return false
    if (q.lastLoginWithinDays && Date.now() - new Date(p.lastLoginAt).getTime() > q.lastLoginWithinDays * 86400_000) return false
    if (q.hasWorks !== undefined) {
      const has = d.works.some((w) => w.ownerId === p.id && w.visibility === 'public' && w.status === 'active')
      if (has !== q.hasWorks) return false
    }
    if (q.interests?.length && !q.interests.some((i) => p.interests.includes(i))) return false
    if (q.commissionStatus?.length && !q.commissionStatus.includes(p.commissionStatus)) return false
    if (q.testUsersOnly && !d.adminMembers.some((m) => m.userId === p.id)) return false
    return true
  })
}

/**
 * 配信の確定。本文は broadcasts に1件だけ保存し、
 * セグメント配信だけ宛先IDの一覧を broadcast_recipients に保存する。
 * Push は 500人ずつに分けて送る（本番は Edge Function `broadcast-dispatch`）。
 */
export function deliverBroadcast(b: Broadcast) {
  const d = db()
  const targets = segmentUsers(b.segmentQuery, b.audience)
  b.status = 'sent'
  b.sentAt = nowIso()
  b.targetCount = targets.length
  if (b.audience !== 'all') for (const u of targets) d.broadcastRecipients.push({ broadcastId: b.id, userId: u.id })
  let delivered = 0
  for (let i = 0; i < targets.length; i += 500) {
    const batch = targets.slice(i, i + 500)
    for (const u of batch) {
      const roomId = officialRoomOf(u.id)
      if (roomId) {
        const room = d.rooms.find((r) => r.id === roomId)!
        room.lastMessageAt = b.sentAt
        room.lastMessagePreview = b.pushText || b.title
        const m = d.roomMembers.find((x) => x.roomId === roomId && x.userId === u.id)
        if (m) m.hiddenAt = null
      }
      const kind = b.kind === 'news' ? 'news' : b.kind === 'important' ? 'important' : 'broadcast'
      notify(u.id, kind, { actorId: OFFICIAL_USER_ID, target: kind === 'news' ? '/news' : roomId ? `/talk/${roomId}` : '/talk', text: b.pushText || b.title })
      if (d.pushSubscriptions.some((s) => s.userId === u.id)) delivered += 1
    }
  }
  // モックは端末の購読が少ないため、到達数を対象の8割で補う
  b.pushDelivered = Math.max(delivered, Math.round(targets.length * 0.8))
}

export function deliverDigest(dg: NewsDigest, actorId: string) {
  const d = db()
  const items = d.newsItems.filter((n) => n.digestId === dg.id && n.rank != null).sort((a, b) => a.rank! - b.rank!)
  const [, m, day] = dg.date.split('-').map(Number)
  const wd = ['日', '月', '火', '水', '木', '金', '土'][new Date(`${dg.date}T00:00:00+09:00`).getDay()]
  const b: Broadcast = {
    id: uuid(),
    title: `AIニュース ${dg.date}`,
    status: 'draft',
    audience: 'all',
    segmentQuery: null,
    bubbles: [
      {
        type: 'carousel',
        cards: [
          { title: `今日のAIニュース ${m}月${day}日(${wd}) ${items.length}本`, body: '1本ずつめくって読めます' },
          ...items.map((n) => ({
            title: n.titleJa || n.title,
            body: n.summaryJa ?? `出典：${d.newsSources.find((s) => s.id === n.sourceId)?.name ?? ''}`,
            buttons: [{ key: n.id, label: '元記事を読む', url: n.url }],
          })),
        ],
      },
    ],
    pushText: `今日のAIニュース ${items.length}本`,
    scheduledAt: null,
    sentAt: null,
    canceledAt: null,
    targetCount: 0,
    pushDelivered: 0,
    createdBy: actorId,
    approvedBy: dg.approvedBy,
    createdAt: nowIso(),
    kind: 'news',
  }
  d.broadcasts.push(b)
  deliverBroadcast(b)
  dg.status = 'sent'
  dg.stage = 'sent'
  dg.sentAt = b.sentAt
  dg.broadcastId = b.id
}

/** 通常配信の1日あたり上限（ZS-BC-09）。AIニュースと重要なお知らせは除く */
export function normalBroadcastsToday(): number {
  const today = jstDateKey(new Date())
  return db().broadcasts.filter(
    (b) => b.kind === 'broadcast' && b.status === 'sent' && !b.canceledAt && b.sentAt && jstDateKey(b.sentAt) === today && b.audience !== 'test',
  ).length
}

export function nameOf(id: string | null) {
  if (!id) return '—'
  return profileOf(id)?.displayName ?? '不明'
}
