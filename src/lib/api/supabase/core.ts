/**
 * Supabase 実装の共通処理：エラーの変換、RPC、ログイン状態の読み込み、Realtime の購読。
 */
import type { RealtimeChannel } from '@supabase/realtime-js'
import { supabase } from '../../supabase/client'
import { ApiError, type ApiErrorCode } from '../errors'
import { capabilities } from '../../restrictions'
import type { RoomSummary } from '../mock/chat'
import type { Profile } from '../../types'
import { emit, members, putProfiles, putWorks, state, clearUserState } from './store'
import {
  toAppeal,
  toAppSettings,
  toBanner,
  toConsent,
  toFriendship,
  toMaster,
  toMember,
  toNgWord,
  toProfile,
  toRestriction,
  toRoom,
  toSettings,
  toWork,
} from './mappers'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>

export const sb = supabase

/** DB 関数が投げる例外名（raise exception 'xxx'）と画面に出す文言 */
const MESSAGES: Record<string, [ApiErrorCode, string]> = {
  unauthenticated: ['unauthenticated', 'ログインしてください'],
  forbidden: ['forbidden', 'この操作の権限がありません'],
  not_found: ['not_found', '見つかりませんでした'],
  invalid: ['invalid', '入力内容を確認してください'],
  restricted: ['restricted', '現在、この操作は制限されています'],
  rate_limited: ['rate_limited', '少し時間をおいてから、もう一度お試しください'],
  blocked: ['blocked', 'このユーザーとはやり取りできません'],
  paused: ['paused', '現在、この機能を一時停止しています'],
  empty_message: ['invalid', 'メッセージを入力してください'],
  empty_name: ['invalid', 'グループ名を入力してください'],
  group_full: ['invalid', 'グループの上限人数に達しています'],
  own_work: ['invalid', '自分の作品には問い合わせできません'],
  commission_closed: ['forbidden', '現在は依頼を受け付けていません'],
  dm_friends_only: ['forbidden', 'この相手は友だちからのメッセージのみ受け付けています'],
  dm_inquiry_only: ['forbidden', 'この相手は作品の問い合わせのみ受け付けています'],
  cannot_unsend: ['invalid', '送信から24時間を過ぎたメッセージは取り消せません'],
  work_incomplete: ['invalid', '公開に必要な項目を入力してください'],
  handle_taken: ['conflict', 'このユーザーIDはすでに使われています'],
  handle_change_too_soon: ['invalid', 'ユーザーIDの変更は30日に1回までです'],
  invalid_handle: ['invalid', 'ユーザーIDは英数字と _ の4〜20文字で入力してください'],
  under_age: ['invalid', 'zenospace は18歳以上の方を対象としています'],
  invalid_birth_ym: ['invalid', '生年月を入力してください'],
  daily_limit: ['invalid', '通常配信は1日2通までです'],
  empty_broadcast: ['invalid', '吹き出しを1つ以上追加してください'],
  invalid_status: ['invalid', 'この状態では操作できません'],
  cannot_cancel: ['invalid', '送信から24時間を過ぎた配信は取り消せません'],
  cannot_restrict_owner: ['forbidden', 'オーナーには制限をかけられません'],
}

/** Supabase のエラーを画面用の ApiError に変える */
export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e
  const err = (e ?? {}) as { message?: string; hint?: string; code?: string; status?: number; name?: string }
  const message = err.message ?? ''
  const known = MESSAGES[message]
  if (known) return new ApiError(known[0], err.hint || known[1])
  if (err.hint) return new ApiError('invalid', err.hint)
  if (err.code === '42501' || /row-level security|permission denied/i.test(message)) return new ApiError('forbidden', 'この操作はできません')
  if (err.code === '23505') return new ApiError('conflict', 'すでに登録されています')
  if (err.code === '23514' || err.code === '22001') return new ApiError('invalid', '入力内容を確認してください（文字数や形式）')
  if (err.code === 'PGRST301' || /JWT/i.test(message)) return new ApiError('unauthenticated', 'ログインの有効期限が切れました。もう一度ログインしてください')
  if (/Failed to fetch|NetworkError|Load failed/i.test(message))
    return new ApiError('invalid', '通信できませんでした。電波の良いところでもう一度お試しください')
  return new ApiError('invalid', message || 'エラーが発生しました。もう一度お試しください')
}

/** RPC を呼ぶ（エラーは ApiError にして投げる） */
export async function rpc<T = unknown>(fn: string, args?: Row): Promise<T> {
  const { data, error } = await sb().rpc(fn, args)
  if (error) throw toApiError(error)
  return data as T
}

/** PostgREST のクエリを待つ（エラーは ApiError にして投げる） */
export async function run<T = any>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await q
  if (error) throw toApiError(error)
  return data as T
}

export function currentUser(): Profile | null {
  return state.me
}

export function requireUser(): Profile {
  const me = state.me
  if (!me) throw new ApiError('unauthenticated', 'ログインしてください')
  if (me.status === 'frozen' || me.status === 'banned') throw new ApiError('restricted', 'このアカウントは利用できません')
  return me
}

export function capsOf() {
  return capabilities(state.restrictions)
}

export function requireCap(cap: keyof ReturnType<typeof capabilities>, message: string) {
  if (!capsOf()[cap]) throw new ApiError('restricted', message)
}

// ---------------------------------------------------------------------------
// 公開データ（未ログインでも読む）：設定・マスタ・バナー・人気タグ
// ---------------------------------------------------------------------------
export async function loadPublic() {
  const [settings, cats, techs, banners, tags] = await Promise.all([
    sb().from('app_settings').select('key,value'),
    sb().from('categories').select('*').order('sort_order'),
    sb().from('techs').select('*').order('sort_order'),
    sb().from('banners').select('*'),
    sb().rpc('popular_tags'),
  ])
  if (settings.data) state.appSettings = toAppSettings(settings.data)
  if (cats.data) state.categories = cats.data.map(toMaster)
  if (techs.data) state.techs = techs.data.map(toMaster)
  if (banners.data) state.banners = banners.data.map(toBanner)
  if (tags.data) state.popularTags = tags.data as string[]
}

// ---------------------------------------------------------------------------
// ログイン中の本人の状態
// ---------------------------------------------------------------------------
export async function loadMe(): Promise<void> {
  const { data: session } = await sb().auth.getSession()
  const user = session.session?.user
  if (!user) {
    state.pendingEmail = null
    stopUserChannel()
    clearUserState()
    return
  }
  let s = await rpc<Row | null>('my_state')
  if (!s?.profile) {
    clearUserState()
    return
  }
  // 退会申請から30日以内に戻ってきたら復元する（ZS-AUTH-09）
  if (s.profile.status === 'leaving') {
    await rpc('restore_account').catch(() => false)
    s = (await rpc<Row | null>('my_state')) ?? s
  }
  // 凍結・停止中はログインしていない扱い（ログイン画面で理由と異議申し立てを出す）
  if (s.profile.status === 'frozen' || s.profile.status === 'banned') {
    clearUserState()
    return
  }
  state.userId = user.id
  state.consents = (s.consents ?? []).map(toConsent)
  // 規約に一度も同意していなければ登録の途中：ログイン済みとして扱わない
  if (!state.consents.length) {
    state.me = null
    state.pendingEmail = user.email ?? ''
    return
  }
  state.pendingEmail = null
  state.me = toProfile(s.profile)
  putProfiles([state.me])
  state.settings = s.settings ? toSettings(s.settings) : null
  state.restrictions = (s.restrictions ?? []).map(toRestriction)
  state.appeals = (s.appeals ?? []).map(toAppeal)
  state.adminRole = s.admin_role ?? null
  state.friendships = (s.friendships ?? []).map(toFriendship)
  state.blocks = new Set(s.blocks ?? [])
  state.likedIds = new Set(s.liked_ids ?? [])
  state.dismissedBanners = new Set(s.dismissed_banners ?? [])
  state.unreadNotifications = Number(s.unread_notifications ?? 0)
  state.identities = [
    ...new Set((user.identities ?? []).map((i) => (i.provider === 'google' || i.provider === 'github' ? i.provider : 'email'))),
  ] as State['identities']
  if (!state.identities.length) state.identities = ['email']
  const [ng, rooms] = await Promise.all([sb().from('ng_words').select('*'), loadRooms(false)])
  if (ng.data) state.ngWords = ng.data.map(toNgWord)
  void rooms
  startUserChannel(user.id)
}
type State = typeof state

/** トークリスト（未読数を含む）を読み直す */
export async function loadRooms(notify = true): Promise<RoomSummary[]> {
  if (!state.userId) return []
  const rows = await rpc<Row[]>('my_rooms')
  const list = rows.map(toSummary)
  state.rooms = list
  if (notify) emit()
  return list
}

function previewOfBubble(b: Row | null | undefined): string {
  if (!b) return ''
  if (b.type === 'text') return String(b.text ?? '').replaceAll('{name}', state.me?.displayName ?? '')
  if (b.type === 'carousel') return b.cards?.[0]?.title ?? 'お知らせ'
  if (b.type === 'card') return b.card?.title ?? 'お知らせ'
  if (b.type === 'work') return '作品を共有しました'
  return '画像'
}

function toSummary(r: Row): RoomSummary {
  const room = toRoom(r.room)
  const member = toMember(r.member)
  const peer = r.peer ? toProfile(r.peer) : null
  const work = r.work ? toWork(r.work) : null
  putProfiles([peer])
  putWorks([work])
  const list = members.get(room.id)
  if (list) members.set(room.id, [...list.filter((m) => m.userId !== member.userId), member])
  let lastMessageAt = room.lastMessageAt
  let lastMessagePreview = room.lastMessagePreview
  if (room.kind === 'official' && r.last_feed_at && r.last_feed_at > lastMessageAt) {
    lastMessageAt = r.last_feed_at
    lastMessagePreview = previewOfBubble(r.last_feed)
  }
  let title: string
  if (room.kind === 'official') title = 'zenospace 公式'
  else if (room.kind === 'group') title = room.name ?? 'グループ'
  else title = peer && !peer.deletedAt ? peer.displayName : '退会したユーザー'
  return {
    room,
    member,
    title,
    peer: room.kind === 'official' ? null : peer,
    work,
    unread: Number(r.unread ?? 0),
    lastMessageAt,
    lastMessagePreview,
    muted: member.notifyLevel === 'off',
    pinned: !!member.pinnedAt,
  }
}

// ---------------------------------------------------------------------------
// Realtime：本人のチャンネル（新着・通知・制限）と、開いているトークのチャンネル
// ---------------------------------------------------------------------------
let userChannel: RealtimeChannel | null = null
let userChannelFor: string | null = null

function startUserChannel(userId: string) {
  if (userChannelFor === userId && userChannel) return
  stopUserChannel()
  userChannelFor = userId
  userChannel = sb()
    .channel(`user:${userId}`, { config: { private: true } })
    .on('broadcast', { event: 'room' }, () => void loadRooms())
    .on('broadcast', { event: 'notification' }, () => void refreshUnreadNotifications())
    .on('broadcast', { event: 'restriction' }, () => void loadMe().then(emit))
    .subscribe()
}

function stopUserChannel() {
  if (userChannel) void sb().removeChannel(userChannel)
  userChannel = null
  userChannelFor = null
}

export async function refreshUnreadNotifications() {
  if (!state.userId) return
  const { count } = await sb().from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
  state.unreadNotifications = count ?? 0
  emit()
}

const roomChannels = new Map<string, RealtimeChannel>()

/** トークを開いている間だけルームのチャンネルを購読する（同時接続数を節約：6章） */
export function watchRoom(roomId: string) {
  if (roomChannels.has(roomId)) return
  // 開いたままにするのは直近3ルームまで
  if (roomChannels.size >= 3) {
    const [oldest, ch] = roomChannels.entries().next().value as [string, RealtimeChannel]
    void sb().removeChannel(ch)
    roomChannels.delete(oldest)
  }
  const ch = sb()
    .channel(`room:${roomId}`, { config: { private: true } })
    .on('broadcast', { event: '*' }, () => emit())
    .subscribe()
  roomChannels.set(roomId, ch)
}

export function unwatchAllRooms() {
  for (const ch of roomChannels.values()) void sb().removeChannel(ch)
  roomChannels.clear()
}

/** 端末の識別情報（ZS-ONE-03）。端末側でハッシュ化して送る */
export async function deviceHash(): Promise<string> {
  const KEY = 'zenospace:device'
  let v: string
  try {
    v = localStorage.getItem(KEY) ?? ''
    if (!v) {
      v = crypto.randomUUID()
      localStorage.setItem(KEY, v)
    }
  } catch {
    v = 'unknown-device'
  }
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`zenospace:${v}`))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
