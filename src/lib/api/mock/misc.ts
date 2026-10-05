/** 8.3 通知、9.3 AIニュース（閲覧側）、ZS-HOME-06 バナー、6.5/7.3 通報 */
import { ApiError } from '../errors'
import { db, delay, done, currentUser, requireUser, profileOf, notify } from './core'
import { nowIso, uuid } from '../../ids'
import type { AppNotification, Banner, Message, NewsDigest, NewsItem, NewsSource, ReportTarget } from '../../types'
import { jstDateKey } from '../../format'

export const notifications = {
  async list(): Promise<AppNotification[]> {
    const me = requireUser()
    const since = Date.now() - 90 * 86400_000 // 直近90日
    return delay(db().notifications.filter((n) => n.userId === me.id && new Date(n.createdAt).getTime() > since))
  },
  unreadCount(): number {
    const me = currentUser()
    if (!me) return 0
    return db().notifications.filter((n) => n.userId === me.id && !n.readAt).length
  },
  async markRead(id: string): Promise<void> {
    const n = db().notifications.find((x) => x.id === id)
    if (n && !n.readAt) n.readAt = nowIso()
    return done(undefined)
  },
  async markAllRead(): Promise<void> {
    const me = requireUser()
    for (const n of db().notifications) if (n.userId === me.id && !n.readAt) n.readAt = nowIso()
    return done(undefined)
  },

  /**
   * ZS-NOTIF-02 Web Push の購読を保存する。
   * 本番は VAPID 公開鍵（VITE_VAPID_PUBLIC_KEY）で pushManager.subscribe し、push_subscriptions に保存する。
   */
  async savePushSubscription(sub: PushSubscriptionJSON | null): Promise<void> {
    const me = requireUser()
    const d = db()
    d.pushSubscriptions = d.pushSubscriptions.filter((s) => s.userId !== me.id || s.endpoint !== (sub?.endpoint ?? 'mock'))
    d.pushSubscriptions.push({
      userId: me.id,
      endpoint: sub?.endpoint ?? 'mock',
      keys: { p256dh: sub?.keys?.p256dh ?? '', auth: sub?.keys?.auth ?? '' },
      userAgent: navigator.userAgent,
      failureCount: 0,
    })
    return done(undefined)
  },
}

export interface DigestWithItems {
  digest: NewsDigest
  items: (NewsItem & { source: NewsSource | undefined; usefulCount: number; useful: boolean; bookmarked: boolean })[]
}

function decorate(digest: NewsDigest): DigestWithItems {
  const d = db()
  const me = currentUser()
  const items = d.newsItems
    .filter((n) => n.digestId === digest.id && n.rank != null)
    .sort((a, b) => a.rank! - b.rank!)
    .map((n) => ({
      ...n,
      source: d.newsSources.find((s) => s.id === n.sourceId),
      usefulCount: d.newsReactions.filter((r) => r.itemId === n.id && r.kind === 'useful').length,
      useful: !!me && d.newsReactions.some((r) => r.itemId === n.id && r.userId === me.id && r.kind === 'useful'),
      bookmarked: !!me && d.newsReactions.some((r) => r.itemId === n.id && r.userId === me.id && r.kind === 'bookmark'),
    }))
  return { digest, items }
}

export const news = {
  /** ZS-NEWS-06 日ごとのダイジェストを新しい順に */
  async digests(): Promise<DigestWithItems[]> {
    return delay(
      db()
        .newsDigests.filter((g) => g.status === 'sent')
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .map(decorate),
    )
  },
  async today(): Promise<DigestWithItems | null> {
    const list = db()
      .newsDigests.filter((g) => g.status === 'sent')
      .sort((a, b) => (a.date < b.date ? 1 : -1))
    const latest = list[0]
    return delay(latest ? decorate(latest) : null)
  },
  isTodayFresh(digest: NewsDigest): boolean {
    return digest.date === jstDateKey(new Date())
  },
  async react(itemId: string, kind: 'useful' | 'bookmark'): Promise<boolean> {
    const me = requireUser()
    const d = db()
    const has = d.newsReactions.some((r) => r.itemId === itemId && r.userId === me.id && r.kind === kind)
    if (has) d.newsReactions = d.newsReactions.filter((r) => !(r.itemId === itemId && r.userId === me.id && r.kind === kind))
    else d.newsReactions.push({ itemId, userId: me.id, kind })
    return done(!has)
  },
  async bookmarks(): Promise<DigestWithItems['items']> {
    const me = requireUser()
    const d = db()
    const ids = new Set(d.newsReactions.filter((r) => r.userId === me.id && r.kind === 'bookmark').map((r) => r.itemId))
    const all = d.newsDigests.map(decorate).flatMap((x) => x.items)
    return delay(all.filter((i) => ids.has(i.id)))
  },
}

export const banners = {
  active(): Banner[] {
    const d = db()
    const me = currentUser()
    const now = new Date()
    return d.banners.filter(
      (b) => new Date(b.startsAt) <= now && new Date(b.endsAt) > now && !(me && d.dismissedBanners.some((x) => x.userId === me.id && x.bannerId === b.id)),
    )
  },
  /** 閉じたら再表示しない */
  dismiss(id: string) {
    const me = currentUser()
    if (me) {
      db().dismissedBanners.push({ userId: me.id, bannerId: id })
      done(undefined)
    } else {
      try {
        localStorage.setItem(`zenospace:banner:${id}`, '1')
      } catch {
        /* noop */
      }
    }
  },
}

export const reports = {
  /**
   * ZS-SAFE-01 / ZS-WORK-20 通報。
   * メッセージの通報は、通報者の同意のもとで該当メッセージと前後5件の写しを提供する。
   */
  async create(input: { targetType: ReportTarget; targetId: string; reason: string; detail: string; shareMessages?: boolean; roomId?: string }): Promise<void> {
    const me = requireUser()
    const d = db()
    if (!input.reason) throw new ApiError('invalid', '理由を選んでください')
    let shared: Message[] | null = null
    if (input.targetType === 'message' && input.shareMessages && input.roomId) {
      const list = d.messages.filter((m) => m.roomId === input.roomId).sort((a, b) => a.id - b.id)
      const i = list.findIndex((m) => String(m.id) === input.targetId)
      if (i >= 0) shared = structuredClone(list.slice(Math.max(0, i - 5), i + 6))
    }
    d.reports.unshift({
      id: uuid(),
      reporterId: me.id,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      detail: input.detail,
      sharedMessages: shared,
      status: 'open',
      assigneeId: null,
      createdAt: nowIso(),
      firstActionAt: null,
      resolvedAt: null,
    })
    // 通報が一定数に達した作品は運営の確認まで自動で非公開（ZS-WORK-20）
    if (input.targetType === 'work') {
      const reporters = new Set(
        d.reports.filter((r) => r.targetType === 'work' && r.targetId === input.targetId && r.status !== 'rejected').map((r) => r.reporterId),
      )
      const w = d.works.find((x) => x.id === input.targetId)
      if (w && reporters.size >= d.settings.reportAutoHideThreshold && w.status === 'active') {
        w.status = 'hidden'
        w.hiddenReason = '通報が一定数に達したため、運営の確認まで非公開にしています'
        notify(w.ownerId, 'important', { target: '/me/works', text: `「${w.title}」は通報が一定数に達したため、運営の確認まで非公開になりました` })
      }
    }
    return done(undefined)
  },
}

export const app = {
  settings() {
    return db().settings
  },
  /** NG ワードは端末内で照合する（19.1：サーバーでは本文を解析しない） */
  ngWords() {
    return db().ngWords
  },
  profileName(id: string) {
    return profileOf(id)?.displayName ?? '退会したユーザー'
  },
}
