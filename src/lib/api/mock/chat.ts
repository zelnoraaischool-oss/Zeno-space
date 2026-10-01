/**
 * 6章 チャット・9.1 公式アカウント。
 * 本番は messages への insert を RLS（has_restriction）と send_message() RPC で検査し、
 * Realtime のプライベートチャンネル `room:{id}` で配信する。
 */
import { ApiError } from '../errors'
import { db, delay, done, currentUser, requireUser, requireCap, profileOf, isBlockedBetween, hasBlocked, isFriend, notify, capsOf } from './core'
import { nextMessageId as nextMessageIdSafe } from '../../mock/db'
import { nowIso, uuid, randomToken } from '../../ids'
import { LIMITS, OFFICIAL_USER_ID } from '../../constants'
import { matchesSearch } from '../../normalize'
import { firstUrl } from '../../markup'
import type { Broadcast, Message, MessageKind, MessageMeta, Profile, ReactionKind, Room, RoomMember, Work } from '../../types'
import { simulatePeer } from './simulate'

export type RoomFilter = 'all' | 'friends' | 'group' | 'inquiry' | 'official'

export interface RoomSummary {
  room: Room
  member: RoomMember
  title: string
  peer: Profile | null
  work: Work | null
  unread: number
  lastMessageAt: string
  lastMessagePreview: string
  muted: boolean
  pinned: boolean
}

export interface RoomDetail {
  room: Room
  me: RoomMember
  title: string
  peer: Profile | null
  work: Work | null
  members: { member: RoomMember; profile: Profile }[]
  announcements: Message[]
  pendingJoins: { member: RoomMember; profile: Profile }[]
  canSend: boolean
}

export interface SendInput {
  kind?: MessageKind
  body: string
  replyToId?: number | null
  meta?: MessageMeta
  clientId: string
}

// ---------- 公式アカウント：配信本文は1件だけ保存し、開いたときに読み出す（9.2） ----------
const BROADCAST_ID_BASE = 1_000_000_000

function visibleBroadcasts(userId: string): Broadcast[] {
  const d = db()
  const me = profileOf(userId)
  if (!me) return []
  const isAdmin = d.adminMembers.some((m) => m.userId === userId)
  return d.broadcasts.filter((b) => {
    if (b.status !== 'sent' || b.canceledAt || !b.sentAt) return false
    if (b.audience === 'test') return isAdmin && d.broadcastRecipients.some((r) => r.broadcastId === b.id && r.userId === userId)
    if (b.audience === 'all') {
      // 全員配信は「配信時点で登録済みのユーザー」が宛先
      return new Date(b.sentAt) >= new Date(me.createdAt) || d.broadcastRecipients.some((r) => r.broadcastId === b.id && r.userId === userId)
    }
    return d.broadcastRecipients.some((r) => r.broadcastId === b.id && r.userId === userId)
  })
}

function broadcastMessages(userId: string, roomId: string): Message[] {
  const d = db()
  const me = profileOf(userId)!
  const out: Message[] = []
  for (const b of visibleBroadcasts(userId)) {
    const idx = d.broadcasts.indexOf(b)
    b.bubbles.forEach((bubble, i) => {
      const personalized = bubble.type === 'text' ? { ...bubble, text: bubble.text.replaceAll('{name}', me.displayName) } : bubble
      out.push({
        id: BROADCAST_ID_BASE + idx * 10 + i,
        roomId,
        senderId: OFFICIAL_USER_ID,
        kind: 'rich',
        body: bubble.type === 'text' ? (personalized.type === 'text' ? personalized.text : '') : '',
        replyToId: null,
        meta: { bubble: personalized, broadcastId: b.id },
        clientId: `b-${b.id}-${i}`,
        createdAt: new Date(new Date(b.sentAt!).getTime() + i).toISOString(),
        unsentAt: null,
      })
    })
  }
  return out
}

function previewOf(m: Message): string {
  if (m.unsentAt) return 'メッセージの送信を取り消しました'
  switch (m.kind) {
    case 'image':
      return '写真を送信しました'
    case 'file':
      return 'ファイルを送信しました'
    case 'work':
      return '作品を共有しました'
    case 'rich': {
      const b = m.meta.bubble
      if (!b) return 'メッセージ'
      if (b.type === 'text') return b.text
      if (b.type === 'carousel') return b.cards[0]?.title ?? 'お知らせ'
      if (b.type === 'card') return b.card.title
      if (b.type === 'work') return '作品を共有しました'
      return '画像'
    }
    default:
      return m.body
  }
}

function roomMessages(room: Room, viewerId: string): Message[] {
  const d = db()
  const hidden = new Set(d.messageHides.filter((h) => h.userId === viewerId).map((h) => h.messageId))
  const blocks = d.blocks.filter((b) => b.blockerId === viewerId)
  let list = d.messages.filter((m) => m.roomId === room.id && !hidden.has(m.id))
  // ZS-SOC-04 ブロックした相手からのメッセージは届かない（相手には通知しない）
  if (blocks.length) list = list.filter((m) => !blocks.some((b) => b.blockedId === m.senderId && new Date(m.createdAt) >= new Date(b.createdAt)))
  if (room.kind === 'official') list = [...list, ...broadcastMessages(viewerId, room.id)]
  const me = d.roomMembers.find((m) => m.roomId === room.id && m.userId === viewerId)
  if (me) list = list.filter((m) => m.kind !== 'system' || new Date(m.createdAt) >= new Date(me.joinedAt) || room.kind !== 'group')
  return list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id))
}

function titleOf(room: Room, viewerId: string): { title: string; peer: Profile | null } {
  const d = db()
  if (room.kind === 'official') return { title: 'zenospace 公式', peer: profileOf(OFFICIAL_USER_ID) ?? null }
  if (room.kind === 'group') return { title: room.name ?? 'グループ', peer: null }
  const other = d.roomMembers.find((m) => m.roomId === room.id && m.userId !== viewerId)
  const peer = other ? (profileOf(other.userId) ?? null) : null
  if (!peer || peer.deletedAt) return { title: '退会したユーザー', peer: null }
  return { title: peer.displayName, peer }
}

function memberOf(roomId: string, userId: string) {
  return db().roomMembers.find((m) => m.roomId === roomId && m.userId === userId)
}

function requireMember(roomId: string, userId: string): { room: Room; member: RoomMember } {
  const room = db().rooms.find((r) => r.id === roomId)
  const member = memberOf(roomId, userId)
  if (!room || !member || member.state === 'left') throw new ApiError('not_found', 'トークが見つかりません')
  if (room.kind !== 'official' && !capsOf(userId).canViewTalks) throw new ApiError('restricted', '現在、トークの利用は停止されています')
  return { room, member }
}

function summarize(room: Room, member: RoomMember, viewerId: string): RoomSummary {
  const d = db()
  const msgs = roomMessages(room, viewerId)
  const last = msgs[msgs.length - 1]
  const unread = msgs.filter((m) => m.senderId !== viewerId && m.createdAt > member.lastReadAt && m.kind !== 'system').length
  const { title, peer } = titleOf(room, viewerId)
  return {
    room,
    member,
    title,
    peer,
    work: room.workId ? (d.works.find((w) => w.id === room.workId) ?? null) : null,
    unread: member.state === 'request' ? 0 : unread,
    lastMessageAt: last?.createdAt ?? room.createdAt,
    lastMessagePreview: last ? previewOf(last) : '',
    muted: member.notifyLevel === 'off',
    pinned: !!member.pinnedAt,
  }
}

function addSystem(room: Room, text: string, actorId: string) {
  const m: Message = {
    id: nextMessageIdSafe(),
    roomId: room.id,
    senderId: actorId,
    kind: 'system',
    body: text,
    replyToId: null,
    meta: {},
    clientId: uuid(),
    createdAt: nowIso(),
    unsentAt: null,
  }
  db().messages.push(m)
  room.lastMessageAt = m.createdAt
  room.lastMessagePreview = text
}

function insertMessage(room: Room, sender: Profile, input: SendInput): Message {
  const d = db()
  const existing = d.messages.find((m) => m.clientId === input.clientId)
  if (existing) return existing // client_id 一意：オフライン再送の二重登録を防ぐ
  const m: Message = {
    id: nextMessageIdSafe(),
    roomId: room.id,
    senderId: sender.id,
    kind: input.kind ?? 'text',
    body: input.body,
    replyToId: input.replyToId ?? null,
    meta: input.meta ?? {},
    clientId: input.clientId,
    createdAt: nowIso(),
    unsentAt: null,
  }
  d.messages.push(m)
  room.lastMessageAt = m.createdAt
  room.lastMessagePreview = previewOf(m)
  const mine = memberOf(room.id, sender.id)
  if (mine) {
    mine.lastReadAt = m.createdAt
    mine.hiddenAt = null
  }
  return m
}

function notifyMembers(room: Room, sender: Profile, m: Message) {
  const d = db()
  const others = d.roomMembers.filter((x) => x.roomId === room.id && x.userId !== sender.id && x.state !== 'left')
  const mentions = new Set(m.meta.mentions ?? [])
  const everyone = m.body.includes('@全員')
  for (const o of others) {
    if (hasBlocked(o.userId, sender.id)) continue
    o.hiddenAt = null
    if (o.state === 'request') {
      // 承認するまで既読と通知は付かない。リクエスト件数だけ知らせる
      const n = d.roomMembers.filter((x) => x.userId === o.userId && x.state === 'request').length
      notify(o.userId, 'request', { actorId: sender.id, target: '/talk/requests', text: `新しいリクエスト ${n}件`, group: true })
      continue
    }
    const isMention = mentions.has(o.userId) || everyone
    if (isMention) {
      // メンションは通知オフでも通知する（ZS-GRP-06）
      notify(o.userId, 'mention', {
        actorId: sender.id,
        target: `/talk/${room.id}`,
        text: `${sender.displayName}さんがあなたをメンションしました：${previewOf(m).slice(0, 40)}`,
      })
      continue
    }
    if (o.notifyLevel !== 'all') continue
    const title = room.kind === 'group' ? `${room.name}：${sender.displayName}` : sender.displayName
    notify(o.userId, 'message', { actorId: sender.id, target: `/talk/${room.id}`, text: `${title}「${previewOf(m).slice(0, 40)}」`, group: true })
  }
}

function checkRate(userId: string) {
  const d = db()
  const since = Date.now() - 60_000
  const count = d.messages.filter((m) => m.senderId === userId && new Date(m.createdAt).getTime() > since).length
  if (count >= d.settings.sendRatePerMinute)
    throw new ApiError('rate_limited', '短時間に多くのメッセージが送信されたため、少し時間をおいてから送信してください')
}

/** ZS-SAFE-02 登録24時間以内は、友だち以外への新規トーク開始を1日10件まで */
function checkNewTalkQuota(me: Profile) {
  const d = db()
  if (Date.now() - new Date(me.createdAt).getTime() > 86400_000) return
  const since = Date.now() - 86400_000
  const started = d.rooms.filter((r) => (r.kind === 'direct' || r.kind === 'inquiry') && r.ownerId === me.id && new Date(r.createdAt).getTime() > since).length
  if (started >= d.settings.newUserDailyNewTalks)
    throw new ApiError('rate_limited', `登録から24時間は、新しいトークの開始は1日${d.settings.newUserDailyNewTalks}件までです`)
}

export const chat = {
  async listRooms(filter: RoomFilter = 'all'): Promise<RoomSummary[]> {
    const me = requireUser()
    const d = db()
    const caps = capsOf(me.id)
    const res = d.roomMembers
      .filter((m) => m.userId === me.id && m.state === 'active')
      .map((m) => ({ m, room: d.rooms.find((r) => r.id === m.roomId)! }))
      .filter(({ room }) => room && (caps.canViewTalks || room.kind === 'official'))
      .map(({ m, room }) => summarize(room, m, me.id))
      .filter((s) => !s.member.hiddenAt || s.lastMessageAt > s.member.hiddenAt)
      .filter((s) => {
        switch (filter) {
          case 'friends':
            return s.room.kind === 'direct' && !!s.peer && isFriend(me.id, s.peer.id)
          case 'group':
            return s.room.kind === 'group'
          case 'inquiry':
            return s.room.kind === 'inquiry'
          case 'official':
            return s.room.kind === 'official'
          default:
            return true
        }
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return a.lastMessageAt < b.lastMessageAt ? 1 : -1
      })
    return delay(res, 40)
  },

  unreadTotal(): number {
    const me = currentUser()
    if (!me) return 0
    const d = db()
    if (!capsOf(me.id).canLogin) return 0
    return d.roomMembers
      .filter((m) => m.userId === me.id && m.state === 'active' && m.notifyLevel !== 'off')
      .reduce((sum, m) => {
        const room = d.rooms.find((r) => r.id === m.roomId)
        return room ? sum + summarize(room, m, me.id).unread : sum
      }, 0)
  },

  requestCount(): number {
    const me = currentUser()
    if (!me) return 0
    return db().roomMembers.filter((m) => m.userId === me.id && m.state === 'request').length
  },

  officialRoomId(): string | null {
    const me = currentUser()
    if (!me) return null
    const d = db()
    const m = d.roomMembers.find((x) => x.userId === me.id && d.rooms.find((r) => r.id === x.roomId)?.kind === 'official')
    return m?.roomId ?? null
  },

  async getRoom(roomId: string): Promise<RoomDetail> {
    const me = requireUser()
    const d = db()
    const room = d.rooms.find((r) => r.id === roomId)
    const mine = memberOf(roomId, me.id)
    if (!room || !mine || mine.state === 'left') throw new ApiError('not_found', 'トークが見つかりません')
    if (room.kind !== 'official' && !capsOf(me.id).canViewTalks) throw new ApiError('restricted', '現在、トークの利用は停止されています')
    const { title, peer } = titleOf(room, me.id)
    const members = d.roomMembers
      .filter((m) => m.roomId === roomId && m.state === 'active')
      .map((member) => ({ member, profile: profileOf(member.userId)! }))
      .filter((x) => x.profile)
    const pendingJoins =
      room.kind === 'group'
        ? d.roomMembers.filter((m) => m.roomId === roomId && m.state === 'request').map((member) => ({ member, profile: profileOf(member.userId)! }))
        : []
    const announcements = d.announcements
      .filter((a) => a.roomId === roomId)
      .map((a) => d.messages.find((m) => m.id === a.messageId))
      .filter((m): m is Message => !!m && !m.unsentAt)
    const caps = capsOf(me.id)
    const blockedByPeer = peer && room.kind !== 'official' ? hasBlocked(me.id, peer.id) : false
    return delay(
      {
        room,
        me: mine,
        title,
        peer,
        work: room.workId ? (d.works.find((w) => w.id === room.workId) ?? null) : null,
        members,
        announcements,
        pendingJoins,
        canSend: room.kind === 'official' ? caps.canLogin : caps.canSendMessage && !blockedByPeer && (room.kind !== 'direct' || !!peer),
      },
      40,
    )
  },

  /** 直近から遡って取得（初回は直近30件：18.1） */
  async listMessages(roomId: string, opts: { before?: string; limit?: number } = {}): Promise<{ messages: Message[]; hasMore: boolean }> {
    const me = requireUser()
    const { room } = requireMember(roomId, me.id)
    let list = roomMessages(room, me.id)
    if (opts.before) list = list.filter((m) => m.createdAt < opts.before!)
    const limit = opts.limit ?? 30
    const slice = list.slice(-limit)
    return delay({ messages: slice, hasMore: list.length > slice.length }, 40)
  },

  messageSync(id: number): Message | undefined {
    return db().messages.find((m) => m.id === id)
  },

  /** 既読 N の計算：自分以外で last_read_at が送信時刻以降の人数 */
  readCount(roomId: string, m: Message): number {
    return db().roomMembers.filter((x) => x.roomId === roomId && x.userId !== m.senderId && x.state === 'active' && x.lastReadAt >= m.createdAt).length
  },

  reactionsOf(messageId: number) {
    return db().reactions.filter((r) => r.messageId === messageId)
  },

  async send(roomId: string, input: SendInput): Promise<Message> {
    const me = requireUser()
    const d = db()
    const room = d.rooms.find((r) => r.id === roomId)
    const mine = memberOf(roomId, me.id)
    if (!room || !mine || mine.state === 'left') throw new ApiError('not_found', 'トークが見つかりません')
    // ZS-ADM-03 制限はサーバー側でも強制する
    if (room.kind === 'official') requireCap(me.id, 'canLogin', 'このアカウントは利用できません')
    else requireCap(me.id, 'canSendMessage', '現在、チャットの送信は制限されています')
    const body = input.body ?? ''
    if (body.length > LIMITS.messageLength) throw new ApiError('invalid', `メッセージは${LIMITS.messageLength.toLocaleString()}文字以内で入力してください`)
    if ((input.kind ?? 'text') === 'text' && !body.trim()) throw new ApiError('invalid', 'メッセージを入力してください')
    if (input.kind === 'image' && d.settings.heavyFeaturesPaused) throw new ApiError('paused', '現在、画像の送信を一時停止しています')
    if (input.kind === 'image' && (input.meta?.images?.length ?? 0) > LIMITS.imagesPerSend)
      throw new ApiError('invalid', `画像は1回${LIMITS.imagesPerSend}枚までです`)
    const peerMember = room.kind === 'direct' || room.kind === 'inquiry' ? d.roomMembers.find((m) => m.roomId === roomId && m.userId !== me.id) : null
    if (peerMember && hasBlocked(me.id, peerMember.userId)) throw new ApiError('blocked', 'ブロック中の相手には送信できません')
    checkRate(me.id)
    if (mine.state === 'request') mine.state = 'active' // 返信したらリクエストを承認したことにする
    const m = insertMessage(room, me, { ...input, body })
    if (room.kind === 'inquiry') {
      const inq = d.inquiries.find((i) => i.roomId === roomId)
      if (inq && inq.toUser === me.id && !inq.firstReplyAt) inq.firstReplyAt = m.createdAt // ZS-INQ-04
    }
    if (room.kind === 'official') {
      // ZS-OFC-04 サポート窓口
      let t = d.supportThreads.find((x) => x.roomId === roomId)
      const first = !t
      if (!t) {
        t = { roomId, userId: me.id, assigneeId: null, status: 'open', lastUserMessageAt: m.createdAt }
        d.supportThreads.unshift(t)
      }
      t.status = 'open'
      t.lastUserMessageAt = m.createdAt
      if (first) {
        const official = profileOf(OFFICIAL_USER_ID)!
        setTimeout(() => {
          insertMessage(room, official, {
            body: 'お問い合わせありがとうございます。運営チームが順に確認し、このトークでお返事します（受付時間 平日10:00〜18:00）。',
            clientId: uuid(),
            meta: { fromAdmin: {} },
          })
          done(undefined)
        }, 800)
      }
    } else {
      notifyMembers(room, me, m)
      simulatePeer(room, me, m)
    }
    return done(m)
  },

  async unsend(messageId: number): Promise<void> {
    const me = requireUser()
    const m = db().messages.find((x) => x.id === messageId)
    if (!m || m.senderId !== me.id) throw new ApiError('not_found', 'メッセージが見つかりません')
    if (Date.now() - new Date(m.createdAt).getTime() > LIMITS.unsendHours * 3600_000)
      throw new ApiError('invalid', '送信から24時間を過ぎたメッセージは取り消せません')
    m.unsentAt = nowIso()
    const room = db().rooms.find((r) => r.id === m.roomId)
    if (room && room.lastMessageAt === m.createdAt) room.lastMessagePreview = 'メッセージの送信を取り消しました'
    return done(undefined)
  },

  async hideForMe(messageId: number): Promise<void> {
    const me = requireUser()
    db().messageHides.push({ userId: me.id, messageId })
    return done(undefined)
  },

  async react(messageId: number, kind: ReactionKind | null): Promise<void> {
    const me = requireUser()
    requireCap(me.id, 'canReact', '現在、リアクションは制限されています')
    const d = db()
    d.reactions = d.reactions.filter((r) => !(r.messageId === messageId && r.userId === me.id))
    if (kind) d.reactions.push({ messageId, userId: me.id, kind, createdAt: nowIso() })
    return done(undefined)
  },

  async markRead(roomId: string): Promise<void> {
    const me = currentUser()
    if (!me) return
    const d = db()
    const mine = memberOf(roomId, me.id)
    const room = d.rooms.find((r) => r.id === roomId)
    if (!mine || !room || mine.state !== 'active') return
    const msgs = roomMessages(room, me.id)
    const last = msgs[msgs.length - 1]
    const target = last && last.createdAt > nowIso() ? last.createdAt : nowIso()
    if (mine.lastReadAt >= (last?.createdAt ?? '')) return
    mine.lastReadAt = target
    if (room.kind === 'official') {
      for (const b of visibleBroadcasts(me.id)) {
        if (!d.broadcastEvents.some((e) => e.broadcastId === b.id && e.userId === me.id && e.kind === 'read'))
          d.broadcastEvents.push({ broadcastId: b.id, userId: me.id, kind: 'read', buttonKey: null, createdAt: nowIso() })
      }
    }
    for (const n of d.notifications) if (n.userId === me.id && n.target === `/talk/${roomId}` && !n.readAt) n.readAt = nowIso()
    done(undefined)
  },

  async recordBroadcastClick(broadcastId: string, buttonKey: string): Promise<void> {
    const me = currentUser()
    if (!me) return
    db().broadcastEvents.push({ broadcastId, userId: me.id, kind: 'click', buttonKey, createdAt: nowIso() })
    done(undefined)
  },

  /** 1:1 トークを開く（ZS-SOC-02/03） */
  async openDirect(userId: string): Promise<string> {
    const me = requireUser()
    const d = db()
    if (userId === me.id) throw new ApiError('invalid', '自分とはトークできません')
    if (userId === OFFICIAL_USER_ID) return chat.officialRoomId()!
    const target = profileOf(userId)
    if (!target || target.deletedAt || target.status === 'banned') throw new ApiError('not_found', 'ユーザーが見つかりません')
    if (isBlockedBetween(me.id, userId) && hasBlocked(userId, me.id)) throw new ApiError('blocked', 'このユーザーにはメッセージを送れません')
    const existing = d.rooms.find(
      (r) =>
        r.kind === 'direct' &&
        d.roomMembers.some((m) => m.roomId === r.id && m.userId === me.id) &&
        d.roomMembers.some((m) => m.roomId === r.id && m.userId === userId),
    )
    if (existing) {
      const mine = memberOf(existing.id, me.id)!
      if (mine.state === 'left') mine.state = 'active'
      mine.hiddenAt = null
      return done(existing.id)
    }
    requireCap(me.id, 'canSendMessage', '現在、チャットの送信は制限されています')
    const targetAddedMe = isFriend(userId, me.id)
    if (!isFriend(me.id, userId)) {
      requireCap(me.id, 'canStartNewTalk', '現在、友だち以外との新しいトークの開始は制限されています')
      checkNewTalkQuota(me)
    }
    if (target.dmPolicy === 'friends' && !targetAddedMe) throw new ApiError('forbidden', 'この相手は友だちからのメッセージのみ受け付けています')
    if (target.dmPolicy === 'inquiry' && !targetAddedMe) throw new ApiError('forbidden', 'この相手は作品の問い合わせのみ受け付けています')
    const ts = nowIso()
    const room: Room = {
      id: uuid(),
      kind: 'direct',
      name: null,
      iconUrl: null,
      iconColor: target.avatarColor,
      ownerId: me.id,
      workId: null,
      lastMessageAt: ts,
      lastMessagePreview: '',
      memberCount: 2,
      createdAt: ts,
    }
    d.rooms.push(room)
    d.roomMembers.push(
      { roomId: room.id, userId: me.id, role: 'member', state: 'active', lastReadAt: ts, notifyLevel: 'all', pinnedAt: null, hiddenAt: null, joinedAt: ts },
      {
        roomId: room.id,
        userId,
        role: 'member',
        state: targetAddedMe ? 'active' : 'request',
        lastReadAt: ts,
        notifyLevel: 'all',
        pinnedAt: null,
        hiddenAt: null,
        joinedAt: ts,
      },
    )
    return done(room.id)
  },

  /** 6.4 作品詳細から問い合わせトークを開く */
  async openInquiry(workId: string): Promise<string> {
    const me = requireUser()
    const d = db()
    const work = d.works.find((w) => w.id === workId && w.status === 'active')
    if (!work) throw new ApiError('not_found', '作品が見つかりません')
    const owner = profileOf(work.ownerId)!
    if (owner.id === me.id) throw new ApiError('invalid', '自分の作品には問い合わせできません')
    if (owner.commissionStatus === 'closed') throw new ApiError('forbidden', '現在は依頼を受け付けていません')
    if (isBlockedBetween(me.id, owner.id)) throw new ApiError('blocked', 'この制作者には問い合わせできません')
    if (owner.dmPolicy === 'friends' && !isFriend(owner.id, me.id)) throw new ApiError('forbidden', 'この制作者は友だちからのメッセージのみ受け付けています')
    const existing = d.inquiries.find((i) => i.workId === workId && i.fromUser === me.id)
    if (existing) return done(existing.roomId)
    requireCap(me.id, 'canSendMessage', '現在、チャットの送信は制限されています')
    if (!isFriend(me.id, owner.id)) {
      requireCap(me.id, 'canStartNewTalk', '現在、友だち以外との新しいトークの開始は制限されています')
      checkNewTalkQuota(me)
    }
    const ts = nowIso()
    const room: Room = {
      id: uuid(),
      kind: 'inquiry',
      name: null,
      iconUrl: null,
      iconColor: owner.avatarColor,
      ownerId: me.id,
      workId,
      lastMessageAt: ts,
      lastMessagePreview: '',
      memberCount: 2,
      createdAt: ts,
    }
    d.rooms.push(room)
    d.roomMembers.push(
      { roomId: room.id, userId: me.id, role: 'member', state: 'active', lastReadAt: ts, notifyLevel: 'all', pinnedAt: null, hiddenAt: null, joinedAt: ts },
      { roomId: room.id, userId: owner.id, role: 'member', state: 'active', lastReadAt: ts, notifyLevel: 'all', pinnedAt: null, hiddenAt: null, joinedAt: ts },
    )
    insertMessage(room, me, { kind: 'work', body: '', meta: { workId }, clientId: uuid() })
    d.inquiries.push({ id: uuid(), roomId: room.id, workId, fromUser: me.id, toUser: owner.id, template: null, createdAt: ts, firstReplyAt: null })
    work.inquiryCount += 1
    const today = new Date().toISOString().slice(0, 10)
    const stat = d.workDailyStats.find((s) => s.workId === workId && s.date === today)
    if (stat) stat.inquiries += 1
    else d.workDailyStats.push({ workId, date: today, views: 0, likes: 0, inquiries: 1 })
    notify(owner.id, 'inquiry', { actorId: me.id, target: `/talk/${room.id}`, text: `${me.displayName}さんから「${work.title}」への問い合わせが届きました` })
    return done(room.id)
  },

  // ---- グループ（6.3） ----
  async createGroup(name: string, memberIds: string[], iconColor = '#22D3EE'): Promise<string> {
    const me = requireUser()
    requireCap(me.id, 'canCreateGroup', '現在、グループの作成は制限されています')
    const d = db()
    if (!name.trim()) throw new ApiError('invalid', 'グループ名を入力してください')
    const ids = [...new Set(memberIds)].filter((id) => id !== me.id && !isBlockedBetween(me.id, id))
    if (ids.length + 1 > d.settings.groupMaxMembers) throw new ApiError('invalid', `グループは${d.settings.groupMaxMembers}人までです`)
    const ts = nowIso()
    const room: Room = {
      id: uuid(),
      kind: 'group',
      name: name.trim().slice(0, 50),
      iconUrl: null,
      iconColor,
      ownerId: me.id,
      workId: null,
      lastMessageAt: ts,
      lastMessagePreview: '',
      memberCount: ids.length + 1,
      createdAt: ts,
    }
    d.rooms.push(room)
    d.roomMembers.push({
      roomId: room.id,
      userId: me.id,
      role: 'owner',
      state: 'active',
      lastReadAt: ts,
      notifyLevel: 'all',
      pinnedAt: null,
      hiddenAt: null,
      joinedAt: ts,
    })
    for (const id of ids)
      d.roomMembers.push({
        roomId: room.id,
        userId: id,
        role: 'member',
        state: 'active',
        lastReadAt: ts,
        notifyLevel: 'all',
        pinnedAt: null,
        hiddenAt: null,
        joinedAt: ts,
      })
    addSystem(room, `${me.displayName}さんがグループを作成しました`, me.id)
    return done(room.id)
  },

  async inviteMembers(roomId: string, userIds: string[]): Promise<void> {
    const me = requireUser()
    requireCap(me.id, 'canCreateGroup', '現在、グループへの招待は制限されています')
    const { room } = requireMember(roomId, me.id)
    if (room.kind !== 'group') throw new ApiError('invalid', 'グループではありません')
    const d = db()
    for (const id of userIds) {
      const m = memberOf(roomId, id)
      if (m && m.state === 'active') continue
      if (room.memberCount + 1 > d.settings.groupMaxMembers) throw new ApiError('invalid', `グループは${d.settings.groupMaxMembers}人までです`)
      if (m) m.state = 'active'
      else
        d.roomMembers.push({
          roomId,
          userId: id,
          role: 'member',
          state: 'active',
          lastReadAt: nowIso(),
          notifyLevel: 'all',
          pinnedAt: null,
          hiddenAt: null,
          joinedAt: nowIso(),
        })
      room.memberCount += 1
      addSystem(room, `${profileOf(id)?.displayName ?? 'ユーザー'}さんが参加しました`, me.id)
    }
    return done(undefined)
  },

  /** ZS-GRP-02 期限付き招待リンク */
  async createInvite(roomId: string, ttl: '24h' | '7d' | 'none', requiresApproval: boolean): Promise<string> {
    const me = requireUser()
    requireCap(me.id, 'canCreateGroup', '現在、グループへの招待は制限されています')
    const { room, member } = requireMember(roomId, me.id)
    if (room.kind !== 'group') throw new ApiError('invalid', 'グループではありません')
    if (member.role === 'member') throw new ApiError('forbidden', '招待リンクは管理者が発行できます')
    const ms = ttl === '24h' ? 86400_000 : ttl === '7d' ? 7 * 86400_000 : null
    const token = randomToken(12)
    db().roomInvites.push({ roomId, token, expiresAt: ms ? new Date(Date.now() + ms).toISOString() : null, requiresApproval })
    return done(token)
  },

  async inviteInfo(token: string): Promise<{ room: Room; requiresApproval: boolean; expired: boolean } | null> {
    const d = db()
    const inv = d.roomInvites.find((i) => i.token === token)
    if (!inv) return delay(null)
    const room = d.rooms.find((r) => r.id === inv.roomId)
    if (!room) return delay(null)
    return delay({ room, requiresApproval: inv.requiresApproval, expired: !!inv.expiresAt && new Date(inv.expiresAt) < new Date() })
  },

  async joinByInvite(token: string): Promise<{ roomId: string; pending: boolean }> {
    const me = requireUser()
    const d = db()
    const inv = d.roomInvites.find((i) => i.token === token)
    if (!inv || (inv.expiresAt && new Date(inv.expiresAt) < new Date())) throw new ApiError('invalid', '招待リンクの有効期限が切れています')
    const room = d.rooms.find((r) => r.id === inv.roomId)!
    const existing = memberOf(room.id, me.id)
    if (existing?.state === 'active') return done({ roomId: room.id, pending: false })
    if (room.memberCount + 1 > d.settings.groupMaxMembers) throw new ApiError('invalid', 'このグループは上限人数に達しています')
    const state = inv.requiresApproval ? 'request' : 'active'
    if (existing) existing.state = state
    else
      d.roomMembers.push({
        roomId: room.id,
        userId: me.id,
        role: 'member',
        state,
        lastReadAt: nowIso(),
        notifyLevel: 'all',
        pinnedAt: null,
        hiddenAt: null,
        joinedAt: nowIso(),
      })
    if (state === 'active') {
      room.memberCount += 1
      addSystem(room, `${me.displayName}さんが参加しました`, me.id)
    }
    return done({ roomId: room.id, pending: state === 'request' })
  },

  async approveJoin(roomId: string, userId: string, approve: boolean): Promise<void> {
    const me = requireUser()
    const { room, member } = requireMember(roomId, me.id)
    if (member.role === 'member') throw new ApiError('forbidden', '管理者のみ操作できます')
    const target = memberOf(roomId, userId)
    if (!target) return
    if (approve) {
      target.state = 'active'
      room.memberCount += 1
      addSystem(room, `${profileOf(userId)?.displayName}さんが参加しました`, me.id)
    } else target.state = 'left'
    return done(undefined)
  },

  async setRole(roomId: string, userId: string, role: 'admin' | 'member'): Promise<void> {
    const me = requireUser()
    const { member } = requireMember(roomId, me.id)
    if (member.role !== 'owner') throw new ApiError('forbidden', 'オーナーのみ操作できます')
    const t = memberOf(roomId, userId)
    if (t && t.role !== 'owner') t.role = role
    return done(undefined)
  },

  async removeMember(roomId: string, userId: string): Promise<void> {
    const me = requireUser()
    const { room, member } = requireMember(roomId, me.id)
    if (member.role === 'member') throw new ApiError('forbidden', '管理者のみ操作できます')
    const t = memberOf(roomId, userId)
    if (!t || t.role === 'owner') throw new ApiError('forbidden', 'オーナーは退出させられません')
    t.state = 'left'
    room.memberCount -= 1
    addSystem(room, `${profileOf(userId)?.displayName}さんが退出しました`, me.id)
    return done(undefined)
  },

  async leave(roomId: string): Promise<void> {
    const me = requireUser()
    const { room, member } = requireMember(roomId, me.id)
    if (room.kind === 'official') throw new ApiError('forbidden', '公式アカウントのトークは退出できません')
    if (room.kind === 'group') {
      if (member.role === 'owner') {
        const next = db().roomMembers.find((m) => m.roomId === roomId && m.userId !== me.id && m.state === 'active')
        if (next) next.role = 'owner'
      }
      room.memberCount -= 1
      addSystem(room, `${me.displayName}さんが退出しました`, me.id)
    }
    member.state = 'left'
    return done(undefined)
  },

  async dissolve(roomId: string): Promise<void> {
    const me = requireUser()
    const { room, member } = requireMember(roomId, me.id)
    if (room.kind !== 'group' || member.role !== 'owner') throw new ApiError('forbidden', 'オーナーのみ解散できます')
    addSystem(room, 'グループは解散されました', me.id)
    for (const m of db().roomMembers.filter((x) => x.roomId === roomId)) m.state = 'left'
    return done(undefined)
  },

  async updateGroup(roomId: string, patch: { name?: string; iconColor?: string }): Promise<void> {
    const me = requireUser()
    const { room, member } = requireMember(roomId, me.id)
    if (member.role === 'member') throw new ApiError('forbidden', '管理者のみ変更できます')
    if (patch.name) room.name = patch.name.slice(0, 50)
    if (patch.iconColor) room.iconColor = patch.iconColor
    return done(undefined)
  },

  /** ZS-GRP-05 アナウンス（最大3件） */
  async pinAnnouncement(roomId: string, messageId: number, pin: boolean): Promise<void> {
    const me = requireUser()
    const { room, member } = requireMember(roomId, me.id)
    if (room.kind === 'group' && member.role === 'member') throw new ApiError('forbidden', 'アナウンスは管理者が設定できます')
    const d = db()
    d.announcements = d.announcements.filter((a) => !(a.roomId === roomId && a.messageId === messageId))
    if (pin) {
      if (d.announcements.filter((a) => a.roomId === roomId).length >= LIMITS.announcements) throw new ApiError('invalid', 'アナウンスは3件までです')
      d.announcements.push({ roomId, messageId, pinnedBy: me.id })
    }
    return done(undefined)
  },

  /** ZS-CHAT-03 ピン留め・通知オフ・非表示・既読にする */
  async updateMembership(roomId: string, patch: { pinned?: boolean; notifyLevel?: RoomMember['notifyLevel']; hidden?: boolean }): Promise<void> {
    const me = requireUser()
    const m = memberOf(roomId, me.id)
    if (!m) throw new ApiError('not_found', 'トークが見つかりません')
    if (patch.pinned !== undefined) {
      if (patch.pinned) {
        const count = db().roomMembers.filter((x) => x.userId === me.id && x.pinnedAt).length
        if (count >= LIMITS.pins) throw new ApiError('invalid', 'ピン留めは5件までです')
        m.pinnedAt = nowIso()
      } else m.pinnedAt = null
    }
    if (patch.notifyLevel) m.notifyLevel = patch.notifyLevel
    if (patch.hidden !== undefined) m.hiddenAt = patch.hidden ? nowIso() : null
    return done(undefined)
  },

  // ---- メッセージリクエスト（ZS-SOC-03） ----
  async listRequests(): Promise<RoomSummary[]> {
    const me = requireUser()
    const d = db()
    return delay(
      d.roomMembers
        .filter((m) => m.userId === me.id && m.state === 'request')
        .map((m) => ({ m, room: d.rooms.find((r) => r.id === m.roomId)! }))
        .filter(({ room }) => room && room.kind !== 'group')
        .map(({ m, room }) => summarize(room, m, me.id))
        .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1)),
    )
  },

  /** リクエストのプレビュー（既読を付けずに読む） */
  async previewRequest(roomId: string): Promise<Message[]> {
    const me = requireUser()
    const d = db()
    const m = memberOf(roomId, me.id)
    const room = d.rooms.find((r) => r.id === roomId)
    if (!m || !room || m.state !== 'request') throw new ApiError('not_found', 'リクエストが見つかりません')
    return delay(roomMessages(room, me.id))
  },

  async acceptRequest(roomId: string): Promise<void> {
    const me = requireUser()
    const m = memberOf(roomId, me.id)
    if (m && m.state === 'request') m.state = 'active'
    return done(undefined)
  },

  async deleteRequest(roomId: string): Promise<void> {
    const me = requireUser()
    const m = memberOf(roomId, me.id)
    if (m) m.state = 'left'
    return done(undefined)
  },

  // ---- 検索・メディア ----
  async search(q: string): Promise<{ room: RoomSummary; message: Message | null }[]> {
    const me = requireUser()
    if (!q.trim()) return delay([])
    const rooms = await chat.listRooms('all')
    const out: { room: RoomSummary; message: Message | null }[] = []
    for (const r of rooms) {
      if (matchesSearch(r.title, q)) out.push({ room: r, message: null })
      for (const m of roomMessages(r.room, me.id)) {
        if (!m.unsentAt && m.kind === 'text' && matchesSearch(m.body, q)) out.push({ room: r, message: m })
      }
    }
    return delay(out.slice(0, 50))
  },

  async searchInRoom(roomId: string, q: string): Promise<Message[]> {
    const me = requireUser()
    const { room } = requireMember(roomId, me.id)
    return delay(roomMessages(room, me.id).filter((m) => !m.unsentAt && m.kind === 'text' && matchesSearch(m.body, q)))
  },

  async media(
    roomId: string,
  ): Promise<{ images: { url: string; thumbUrl: string; messageId: number }[]; links: { url: string; messageId: number; at: string }[] }> {
    const me = requireUser()
    const { room } = requireMember(roomId, me.id)
    const msgs = roomMessages(room, me.id).filter((m) => !m.unsentAt)
    const images = msgs.flatMap((m) => (m.meta.images ?? []).map((i) => ({ url: i.url, thumbUrl: i.thumbUrl, messageId: m.id })))
    const links = msgs.filter((m) => m.kind === 'text' && firstUrl(m.body)).map((m) => ({ url: firstUrl(m.body)!, messageId: m.id, at: m.createdAt }))
    return delay({ images: images.reverse(), links: links.reverse() })
  },
}
