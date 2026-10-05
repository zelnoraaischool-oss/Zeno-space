/**
 * 6章 チャット・9.1 公式アカウント（Supabase）。
 * 送信は send_message() RPC（制限・ブロック・レート制限をサーバーで強制）、新着は Realtime で受け取る。
 */
import { ApiError } from '../errors'
import type { RoomDetail, RoomFilter, RoomSummary, SendInput } from '../mock/chat'
import type { Bubble, Message, Profile, Reaction, ReactionKind, Room, RoomMember, Work } from '../../types'
import { LIMITS, OFFICIAL_USER_ID } from '../../constants'
import { matchesSearch } from '../../normalize'
import { firstUrl } from '../../markup'
import { BROADCAST_ID_BASE } from '../shared'
import { emit, members, messages, profiles, putMessages, putWorks, reactions, state, works } from './store'
import { capsOf, loadRooms, requireCap, requireUser, rpc, run, sb, watchRoom } from './core'
import { fetchProfiles } from './users'
import { toMember, toMessage, toReaction, toRoom, toWork, WORK_SELECT } from './mappers'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>

// ---------- 公式アカウント：配信本文は1件だけ保存し、開いたときに読み出す（9.2） ----------
async function officialFeed(roomId: string): Promise<Message[]> {
  const rows = await rpc<Row[]>('official_feed', { p_limit: 200 })
  const name = state.me?.displayName ?? ''
  const sorted = [...rows].sort((a, b) => (a.sent_at < b.sent_at ? -1 : 1))
  const out: Message[] = []
  sorted.forEach((b, idx) => {
    ;(b.bubbles as Bubble[]).forEach((bubble, i) => {
      const personalized: Bubble = bubble.type === 'text' ? { ...bubble, text: bubble.text.replaceAll('{name}', name) } : bubble
      out.push({
        id: BROADCAST_ID_BASE + idx * 10 + i,
        roomId,
        senderId: OFFICIAL_USER_ID,
        kind: 'rich',
        body: personalized.type === 'text' ? personalized.text : '',
        replyToId: null,
        meta: { bubble: personalized, broadcastId: b.broadcast_id },
        clientId: `b-${b.broadcast_id}-${i}`,
        createdAt: new Date(new Date(b.sent_at).getTime() + i).toISOString(),
        unsentAt: null,
      })
    })
  })
  return out
}

function byTime(a: Message, b: Message) {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id
}

async function loadReactions(ids: number[]) {
  const real = ids.filter((id) => id > 0 && id < BROADCAST_ID_BASE)
  if (!real.length) return
  const rows = await run(sb().from('reactions').select('*').in('message_id', real))
  const map = new Map<number, Reaction[]>()
  for (const id of real) map.set(id, [])
  for (const r of (rows as Row[]).map(toReaction)) map.get(r.messageId)?.push(r)
  for (const [id, list] of map) reactions.set(id, list)
}

async function loadMembers(roomId: string): Promise<RoomMember[]> {
  const rows = await run(sb().from('room_members').select('*').eq('room_id', roomId))
  const list = (rows as Row[]).map(toMember)
  members.set(roomId, list)
  return list
}

function summaryOf(roomId: string): RoomSummary | undefined {
  return state.rooms.find((r) => r.room.id === roomId)
}

/** メッセージの返信元などが読み込み範囲の外にあるときに裏で読む */
const requestedMessages = new Set<number>()
function ensureMessage(id: number) {
  if (messages.has(id) || requestedMessages.has(id) || id >= BROADCAST_ID_BASE) return
  requestedMessages.add(id)
  void sb()
    .from('messages')
    .select('*')
    .eq('id', id)
    .maybeSingle()
    .then(({ data }) => {
      if (data) {
        putMessages([toMessage(data)])
        emit()
      }
    })
}

async function messagesOf(roomId: string, opts: { before?: string; limit?: number; query?: string } = {}): Promise<{ list: Message[]; more: boolean }> {
  const limit = opts.limit ?? 30
  let q = sb()
    .from('messages')
    .select('*')
    .eq('room_id', roomId)
    .order('id', { ascending: false })
    .limit(limit + 1)
  if (opts.before) q = q.lt('created_at', opts.before)
  const rows = (await run(q)) as Row[]
  const more = rows.length > limit
  const list = rows.slice(0, limit).map(toMessage)
  putMessages(list)
  return { list, more }
}

export const chat = {
  async listRooms(filter: RoomFilter = 'all'): Promise<RoomSummary[]> {
    const me = requireUser()
    const caps = capsOf()
    const all = await loadRooms(false)
    return all
      .filter((s) => s.member.state === 'active')
      .filter((s) => caps.canViewTalks || s.room.kind === 'official')
      .filter((s) => !s.member.hiddenAt || s.lastMessageAt > s.member.hiddenAt)
      .filter((s) => {
        switch (filter) {
          case 'friends':
            return s.room.kind === 'direct' && !!s.peer && state.friendships.some((f) => f.userId === me.id && f.friendId === s.peer!.id)
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
  },

  unreadTotal(): number {
    if (!state.me || !capsOf().canLogin) return 0
    return state.rooms.filter((s) => s.member.state === 'active' && s.member.notifyLevel !== 'off').reduce((n, s) => n + s.unread, 0)
  },

  requestCount(): number {
    return state.rooms.filter((s) => s.member.state === 'request').length
  },

  officialRoomId(): string | null {
    return state.rooms.find((s) => s.room.kind === 'official')?.room.id ?? null
  },

  async getRoom(roomId: string): Promise<RoomDetail> {
    const me = requireUser()
    const roomRow = await run(sb().from('rooms').select('*').eq('id', roomId).maybeSingle())
    if (!roomRow) throw new ApiError('not_found', 'トークが見つかりません')
    const room = toRoom(roomRow)
    const list = await loadMembers(roomId)
    const mine = list.find((m) => m.userId === me.id)
    if (!mine || mine.state === 'left') throw new ApiError('not_found', 'トークが見つかりません')
    const caps = capsOf()
    if (room.kind !== 'official' && !caps.canViewTalks) throw new ApiError('restricted', '現在、トークの利用は停止されています')
    watchRoom(roomId)
    const profilesList = await fetchProfiles(list.map((m) => m.userId))
    const pmap = new Map(profilesList.map((p) => [p.id, p]))
    let peer: Profile | null = null
    let title: string
    if (room.kind === 'official') {
      title = 'zenospace 公式'
      peer = profiles.get(OFFICIAL_USER_ID) ?? null
    } else if (room.kind === 'group') title = room.name ?? 'グループ'
    else {
      const other = list.find((m) => m.userId !== me.id)
      peer = other ? (pmap.get(other.userId) ?? null) : null
      title = peer && !peer.deletedAt ? peer.displayName : '退会したユーザー'
      if (peer?.deletedAt) peer = null
    }
    let work: Work | null = null
    if (room.workId) {
      work = works.get(room.workId) ?? null
      if (!work) {
        const w = await run(sb().from('works').select(WORK_SELECT).eq('id', room.workId).maybeSingle())
        work = w ? toWork(w) : null
        putWorks([work])
      }
    }
    const ann = (await run(sb().from('room_announcements').select('message_id,messages(*)').eq('room_id', roomId))) as Row[]
    const announcements = ann.map((a) => (a.messages ? toMessage(a.messages) : null)).filter((m): m is Message => !!m && !m.unsentAt)
    putMessages(announcements)
    const active = list.filter((m) => m.state === 'active')
    const blockedPeer = peer && room.kind !== 'official' ? state.blocks.has(peer.id) : false
    return {
      room,
      me: mine,
      title,
      peer,
      work,
      members: active.map((member) => ({ member, profile: pmap.get(member.userId)! })).filter((x) => x.profile),
      announcements,
      pendingJoins:
        room.kind === 'group'
          ? list
              .filter((m) => m.state === 'request')
              .map((member) => ({ member, profile: pmap.get(member.userId)! }))
              .filter((x) => x.profile)
          : [],
      canSend: room.kind === 'official' ? caps.canLogin : caps.canSendMessage && !blockedPeer && (room.kind !== 'direct' || !!peer),
    }
  },

  /** 直近から遡って取得（初回は直近30件：18.1） */
  async listMessages(roomId: string, opts: { before?: string; limit?: number } = {}): Promise<{ messages: Message[]; hasMore: boolean }> {
    const me = requireUser()
    const limit = opts.limit ?? 30
    const { list, more } = await messagesOf(roomId, opts)
    let all = list
    const s = summaryOf(roomId)
    const room = s?.room
    if (room?.kind === 'official') {
      let feed = await officialFeed(roomId)
      if (opts.before) feed = feed.filter((m) => m.createdAt < opts.before!)
      all = [...list, ...feed]
    }
    // グループに参加する前のシステムメッセージは出さない
    const mine = (members.get(roomId) ?? []).find((m) => m.userId === me.id)
    if (room?.kind === 'group' && mine) all = all.filter((m) => m.kind !== 'system' || m.createdAt >= mine.joinedAt)
    all.sort(byTime)
    const slice = all.slice(-limit)
    await loadReactions(slice.map((m) => m.id))
    for (const m of slice) if (m.replyToId) ensureMessage(m.replyToId)
    return { messages: slice, hasMore: more || all.length > slice.length }
  },

  messageSync(id: number): Message | undefined {
    const m = messages.get(id)
    if (!m) ensureMessage(id)
    return m
  },

  /** 既読 N の計算：自分以外で last_read_at が送信時刻以降の人数 */
  readCount(roomId: string, m: Message): number {
    return (members.get(roomId) ?? []).filter((x) => x.userId !== m.senderId && x.state === 'active' && x.lastReadAt >= m.createdAt).length
  },

  reactionsOf(messageId: number): Reaction[] {
    return reactions.get(messageId) ?? []
  },

  async send(roomId: string, input: SendInput): Promise<Message> {
    requireUser()
    const s = summaryOf(roomId)
    if (s?.room.kind === 'official') requireCap('canLogin', 'このアカウントは利用できません')
    else requireCap('canSendMessage', '現在、チャットの送信は制限されています')
    const body = input.body ?? ''
    if (body.length > LIMITS.messageLength) throw new ApiError('invalid', `メッセージは${LIMITS.messageLength.toLocaleString()}文字以内で入力してください`)
    if ((input.kind ?? 'text') === 'text' && !body.trim()) throw new ApiError('invalid', 'メッセージを入力してください')
    if (input.kind === 'image' && state.appSettings.heavyFeaturesPaused) throw new ApiError('paused', '現在、画像の送信を一時停止しています')
    if (input.kind === 'image' && (input.meta?.images?.length ?? 0) > LIMITS.imagesPerSend)
      throw new ApiError('invalid', `画像は1回${LIMITS.imagesPerSend}枚までです`)
    const row = await rpc<Row>('send_message', {
      p_room: roomId,
      p_body: body,
      p_client_id: input.clientId,
      p_kind: input.kind ?? 'text',
      p_reply_to: input.replyToId ?? null,
      p_meta: input.meta ?? {},
    })
    const m = toMessage(row)
    putMessages([m])
    void loadRooms()
    emit()
    return m
  },

  async unsend(messageId: number): Promise<void> {
    requireUser()
    await rpc('unsend_message', { p_message: messageId })
    const m = messages.get(messageId)
    if (m) messages.set(messageId, { ...m, unsentAt: new Date().toISOString() })
    emit()
  },

  async hideForMe(messageId: number): Promise<void> {
    const me = requireUser()
    await run(sb().from('message_hides').insert({ user_id: me.id, message_id: messageId }))
    emit()
  },

  async react(messageId: number, kind: ReactionKind | null): Promise<void> {
    const me = requireUser()
    requireCap('canReact', '現在、リアクションは制限されています')
    await run(sb().from('reactions').delete().eq('message_id', messageId).eq('user_id', me.id))
    const list = (reactions.get(messageId) ?? []).filter((r) => r.userId !== me.id)
    if (kind) {
      await run(sb().from('reactions').insert({ message_id: messageId, user_id: me.id, kind }))
      list.push({ messageId, userId: me.id, kind, createdAt: new Date().toISOString() })
    }
    reactions.set(messageId, list)
    emit()
  },

  /** 未読があるときだけサーバーに既読を送る（画面が描き直すたびに呼ばれても送りすぎない） */
  async markRead(roomId: string): Promise<void> {
    const me = state.me
    if (!me) return
    const s = summaryOf(roomId)
    if (!s || s.member.state !== 'active' || s.unread === 0) return
    s.unread = 0
    await rpc('mark_read', { p_room: roomId }).catch(() => undefined)
    const now = new Date().toISOString()
    s.member = { ...s.member, lastReadAt: now }
    const list = members.get(roomId)
    if (list)
      members.set(
        roomId,
        list.map((m) => (m.userId === me.id ? { ...m, lastReadAt: now } : m)),
      )
    emit()
  },

  async recordBroadcastClick(broadcastId: string, buttonKey: string): Promise<void> {
    const me = state.me
    if (!me) return
    await sb().from('broadcast_events').insert({ broadcast_id: broadcastId, user_id: me.id, kind: 'click', button_key: buttonKey })
  },

  /** 1:1 トークを開く（ZS-SOC-02/03） */
  async openDirect(userId: string): Promise<string> {
    const me = requireUser()
    if (userId === me.id) throw new ApiError('invalid', '自分とはトークできません')
    const id = await rpc<string>('open_direct', { p_target: userId })
    await loadRooms()
    return id
  },

  /** 6.4 作品詳細から問い合わせトークを開く */
  async openInquiry(workId: string): Promise<string> {
    requireUser()
    const id = await rpc<string>('open_inquiry', { p_work: workId })
    await loadRooms()
    return id
  },

  // ---- グループ（6.3） ----
  async createGroup(name: string, memberIds: string[], iconColor = '#3D6B52'): Promise<string> {
    requireUser()
    requireCap('canCreateGroup', '現在、グループの作成は制限されています')
    if (!name.trim()) throw new ApiError('invalid', 'グループ名を入力してください')
    const id = await rpc<string>('create_group', { p_name: name.trim(), p_members: memberIds, p_color: iconColor })
    await loadRooms()
    return id
  },

  async inviteMembers(roomId: string, userIds: string[]): Promise<void> {
    requireUser()
    requireCap('canCreateGroup', '現在、グループへの招待は制限されています')
    await rpc('room_invite_members', { p_room: roomId, p_users: userIds })
    emit()
  },

  /** ZS-GRP-02 期限付き招待リンク */
  async createInvite(roomId: string, ttl: '24h' | '7d' | 'none', requiresApproval: boolean): Promise<string> {
    requireUser()
    const hours = ttl === '24h' ? 24 : ttl === '7d' ? 168 : null
    return rpc<string>('room_create_invite', { p_room: roomId, p_ttl_hours: hours, p_requires_approval: requiresApproval })
  },

  async inviteInfo(token: string): Promise<{ room: Room; requiresApproval: boolean; expired: boolean } | null> {
    const r = await rpc<Row | null>('room_invite_info', { p_token: token })
    if (!r) return null
    return { room: toRoom(r.room), requiresApproval: !!r.requires_approval, expired: !!r.expired }
  },

  async joinByInvite(token: string): Promise<{ roomId: string; pending: boolean }> {
    requireUser()
    const r = await rpc<Row>('room_join_by_invite', { p_token: token })
    await loadRooms()
    return { roomId: r.room_id, pending: !!r.pending }
  },

  async approveJoin(roomId: string, userId: string, approve: boolean): Promise<void> {
    await rpc('room_approve_join', { p_room: roomId, p_user: userId, p_approve: approve })
    emit()
  },

  async setRole(roomId: string, userId: string, role: 'admin' | 'member'): Promise<void> {
    await rpc('room_set_role', { p_room: roomId, p_user: userId, p_role: role })
    emit()
  },

  async removeMember(roomId: string, userId: string): Promise<void> {
    await rpc('room_remove_member', { p_room: roomId, p_user: userId })
    emit()
  },

  async leave(roomId: string): Promise<void> {
    await rpc('room_leave', { p_room: roomId })
    await loadRooms()
  },

  async dissolve(roomId: string): Promise<void> {
    await rpc('room_dissolve', { p_room: roomId })
    await loadRooms()
  },

  async updateGroup(roomId: string, patch: { name?: string; iconColor?: string }): Promise<void> {
    await rpc('room_update_group', { p_room: roomId, p_name: patch.name ?? null, p_color: patch.iconColor ?? null })
    await loadRooms()
  },

  /** ZS-GRP-05 アナウンス（最大3件） */
  async pinAnnouncement(roomId: string, messageId: number, pin: boolean): Promise<void> {
    await rpc('room_pin_announcement', { p_room: roomId, p_message: messageId, p_pin: pin })
    emit()
  },

  /** ZS-CHAT-03 ピン留め・通知オフ・非表示 */
  async updateMembership(roomId: string, patch: { pinned?: boolean; notifyLevel?: RoomMember['notifyLevel']; hidden?: boolean }): Promise<void> {
    const me = requireUser()
    const row: Row = {}
    if (patch.pinned !== undefined) {
      if (patch.pinned && state.rooms.filter((s) => s.pinned).length >= LIMITS.pins) throw new ApiError('invalid', 'ピン留めは5件までです')
      row.pinned_at = patch.pinned ? new Date().toISOString() : null
    }
    if (patch.notifyLevel) row.notify_level = patch.notifyLevel
    if (patch.hidden !== undefined) row.hidden_at = patch.hidden ? new Date().toISOString() : null
    await run(sb().from('room_members').update(row).eq('room_id', roomId).eq('user_id', me.id))
    await loadRooms()
  },

  // ---- メッセージリクエスト（ZS-SOC-03） ----
  async listRequests(): Promise<RoomSummary[]> {
    requireUser()
    const all = await loadRooms(false)
    return all.filter((s) => s.member.state === 'request' && s.room.kind !== 'group').sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1))
  },

  /** リクエストのプレビュー（既読を付けずに読む） */
  async previewRequest(roomId: string): Promise<Message[]> {
    requireUser()
    const { list } = await messagesOf(roomId, { limit: 100 })
    return list.sort(byTime)
  },

  async acceptRequest(roomId: string): Promise<void> {
    await rpc('request_respond', { p_room: roomId, p_accept: true })
    await loadRooms()
  },

  async deleteRequest(roomId: string): Promise<void> {
    await rpc('request_respond', { p_room: roomId, p_accept: false })
    await loadRooms()
  },

  // ---- 検索・メディア ----
  async search(q: string): Promise<{ room: RoomSummary; message: Message | null }[]> {
    requireUser()
    const text = q.trim()
    if (!text) return []
    const rooms = await chat.listRooms('all')
    const out: { room: RoomSummary; message: Message | null }[] = []
    for (const r of rooms) if (matchesSearch(r.title, text)) out.push({ room: r, message: null })
    const rows = (await run(
      sb()
        .from('messages')
        .select('*')
        .eq('kind', 'text')
        .is('unsent_at', null)
        .ilike('body', `%${text.replace(/[%_]/g, '\\$&')}%`)
        .order('id', { ascending: false })
        .limit(50),
    )) as Row[]
    const byRoom = new Map(rooms.map((r) => [r.room.id, r]))
    for (const m of rows.map(toMessage)) {
      const r = byRoom.get(m.roomId)
      if (r) out.push({ room: r, message: m })
    }
    putMessages(rows.map(toMessage))
    return out.slice(0, 50)
  },

  async searchInRoom(roomId: string, q: string): Promise<Message[]> {
    requireUser()
    const text = q.trim()
    if (!text) return []
    const rows = (await run(
      sb()
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .eq('kind', 'text')
        .is('unsent_at', null)
        .ilike('body', `%${text.replace(/[%_]/g, '\\$&')}%`)
        .order('id', { ascending: true })
        .limit(100),
    )) as Row[]
    const list = rows.map(toMessage)
    putMessages(list)
    return list
  },

  async media(
    roomId: string,
  ): Promise<{ images: { url: string; thumbUrl: string; messageId: number }[]; links: { url: string; messageId: number; at: string }[] }> {
    requireUser()
    const rows = (await run(
      sb().from('messages').select('*').eq('room_id', roomId).in('kind', ['image', 'text']).is('unsent_at', null).order('id', { ascending: false }).limit(500),
    )) as Row[]
    const msgs = rows.map(toMessage)
    const images = msgs.flatMap((m) => (m.meta.images ?? []).map((i) => ({ url: i.url, thumbUrl: i.thumbUrl, messageId: m.id })))
    const links = msgs.filter((m) => m.kind === 'text' && firstUrl(m.body)).map((m) => ({ url: firstUrl(m.body)!, messageId: m.id, at: m.createdAt }))
    return { images, links }
  },
}
