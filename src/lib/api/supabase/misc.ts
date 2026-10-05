/** 8.3 通知、9.3 AIニュース（閲覧側）、ZS-HOME-06 バナー、6.5/7.3 通報、アプリ設定（Supabase） */
import { ApiError } from '../errors'
import type { DigestWithItems } from '../mock/misc'
import type { AppNotification, AppSettings, Banner, Message, NewsDigest, NgWord, ReportTarget } from '../../types'
import { jstDateKey } from '../../format'
import { emit, profiles, state } from './store'
import { refreshUnreadNotifications, requireUser, rpc, run, sb } from './core'
import { ensureProfiles } from './users'
import { toDigest, toMessage, toNewsItem, toNotification, toSource } from './mappers'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>

export const notifications = {
  async list(): Promise<AppNotification[]> {
    requireUser()
    const since = new Date(Date.now() - 90 * 86400_000).toISOString() // 直近90日
    const rows = (await run(sb().from('notifications').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(200))) as Row[]
    const list = rows.map(toNotification)
    ensureProfiles(list.map((n) => n.actorId))
    return list
  },
  unreadCount(): number {
    return state.unreadNotifications
  },
  async markRead(id: string): Promise<void> {
    await run(sb().from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null))
    await refreshUnreadNotifications()
  },
  async markAllRead(): Promise<void> {
    requireUser()
    await run(sb().from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null))
    state.unreadNotifications = 0
    emit()
  },

  /** ZS-NOTIF-02 Web Push の購読を保存する（送信は Edge Function `push-dispatch`） */
  async savePushSubscription(sub: PushSubscriptionJSON | null): Promise<void> {
    const me = requireUser()
    if (!sub?.endpoint) return
    await run(
      sb()
        .from('push_subscriptions')
        .upsert(
          { user_id: me.id, endpoint: sub.endpoint, keys: sub.keys ?? {}, user_agent: navigator.userAgent.slice(0, 200), failure_count: 0 },
          { onConflict: 'endpoint' },
        ),
    )
  },
}

async function decorate(digests: NewsDigest[]): Promise<DigestWithItems[]> {
  if (!digests.length) return []
  const [items, sources] = await Promise.all([
    run(
      sb()
        .from('news_items')
        .select('*')
        .in(
          'digest_id',
          digests.map((d) => d.id),
        )
        .not('rank', 'is', null)
        .order('rank'),
    ),
    run(sb().from('news_sources').select('*')),
  ])
  const list = (items as Row[]).map(toNewsItem)
  const srcs = (sources as Row[]).map(toSource)
  const counts = await rpc<Record<string, number>>('news_useful_counts', { p_items: list.map((i) => i.id) })
  let mine: Row[] = []
  if (state.userId)
    mine = (await run(
      sb()
        .from('news_reactions')
        .select('*')
        .in(
          'item_id',
          list.map((i) => i.id),
        ),
    )) as Row[]
  return digests.map((digest) => ({
    digest,
    items: list
      .filter((n) => n.digestId === digest.id)
      .map((n) => ({
        ...n,
        source: srcs.find((s) => s.id === n.sourceId),
        usefulCount: Number(counts[n.id] ?? 0),
        useful: mine.some((r) => r.item_id === n.id && r.kind === 'useful'),
        bookmarked: mine.some((r) => r.item_id === n.id && r.kind === 'bookmark'),
      })),
  }))
}

export const news = {
  /** ZS-NEWS-06 日ごとのダイジェストを新しい順に */
  async digests(): Promise<DigestWithItems[]> {
    const rows = (await run(sb().from('news_digests').select('*').eq('status', 'sent').order('date', { ascending: false }).limit(30))) as Row[]
    return decorate(rows.map(toDigest))
  },
  async today(): Promise<DigestWithItems | null> {
    const rows = (await run(sb().from('news_digests').select('*').eq('status', 'sent').order('date', { ascending: false }).limit(1))) as Row[]
    const [d] = await decorate(rows.map(toDigest))
    return d ?? null
  },
  isTodayFresh(digest: NewsDigest): boolean {
    return digest.date === jstDateKey(new Date())
  },
  async react(itemId: string, kind: 'useful' | 'bookmark'): Promise<boolean> {
    const me = requireUser()
    const has = (await run(sb().from('news_reactions').select('item_id').eq('item_id', itemId).eq('kind', kind))) as Row[]
    if (has.length) await run(sb().from('news_reactions').delete().eq('item_id', itemId).eq('user_id', me.id).eq('kind', kind))
    else await run(sb().from('news_reactions').insert({ item_id: itemId, user_id: me.id, kind }))
    emit()
    return !has.length
  },
  async bookmarks(): Promise<DigestWithItems['items']> {
    requireUser()
    const rows = (await run(sb().from('news_reactions').select('item_id').eq('kind', 'bookmark'))) as Row[]
    const ids = new Set(rows.map((r) => r.item_id))
    if (!ids.size) return []
    const digests = (await run(sb().from('news_digests').select('*').eq('status', 'sent').order('date', { ascending: false }).limit(60))) as Row[]
    const all = (await decorate(digests.map(toDigest))).flatMap((d) => d.items)
    return all.filter((i) => ids.has(i.id))
  },
}

export const banners = {
  active(): Banner[] {
    const now = new Date()
    return state.banners.filter((b) => {
      if (new Date(b.startsAt) > now || new Date(b.endsAt) <= now) return false
      if (state.dismissedBanners.has(b.id)) return false
      if (!state.me) {
        try {
          if (localStorage.getItem(`zenospace:banner:${b.id}`)) return false
        } catch {
          /* noop */
        }
      }
      return true
    })
  },
  /** 閉じたら再表示しない */
  dismiss(id: string) {
    state.dismissedBanners = new Set([...state.dismissedBanners, id])
    if (state.me) void sb().from('banner_dismissals').insert({ user_id: state.me.id, banner_id: id })
    else {
      try {
        localStorage.setItem(`zenospace:banner:${id}`, '1')
      } catch {
        /* noop */
      }
    }
    emit()
  },
}

export const reports = {
  /**
   * ZS-SAFE-01 / ZS-WORK-20 通報。
   * メッセージの通報は、通報者の同意のもとで該当メッセージと前後5件の写しを提供する。
   */
  async create(input: { targetType: ReportTarget; targetId: string; reason: string; detail: string; shareMessages?: boolean; roomId?: string }): Promise<void> {
    const me = requireUser()
    if (!input.reason) throw new ApiError('invalid', '理由を選んでください')
    let shared: Message[] | null = null
    if (input.targetType === 'message' && input.shareMessages && input.roomId) {
      const id = Number(input.targetId)
      const [before, after] = await Promise.all([
        run(sb().from('messages').select('*').eq('room_id', input.roomId).lte('id', id).order('id', { ascending: false }).limit(6)),
        run(sb().from('messages').select('*').eq('room_id', input.roomId).gt('id', id).order('id').limit(5)),
      ])
      shared = [...(before as Row[]).reverse(), ...(after as Row[])].map(toMessage)
    }
    await run(
      sb()
        .from('reports')
        .insert({
          reporter_id: me.id,
          target_type: input.targetType,
          target_id: input.targetId,
          reason: input.reason,
          detail: input.detail.slice(0, 500),
          shared_messages: shared
            ? shared.map((m) => ({
                id: m.id,
                room_id: m.roomId,
                sender_id: m.senderId,
                kind: m.kind,
                body: m.body,
                meta: m.meta,
                created_at: m.createdAt,
                client_id: m.clientId,
              }))
            : null,
        }),
    )
  },
}

export const app = {
  settings(): AppSettings {
    return state.appSettings
  },
  /** NG ワードは端末内で照合する（19.1：サーバーでは本文を解析しない） */
  ngWords(): NgWord[] {
    return state.ngWords
  },
  profileName(id: string): string {
    const p = profiles.get(id)
    if (!p) {
      ensureProfiles([id])
      return ''
    }
    return p.deletedAt ? '退会したユーザー' : p.displayName
  },
}
