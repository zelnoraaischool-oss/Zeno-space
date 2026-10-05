/** 5.3 プロフィール、5.4 つながり、8.4 設定（Supabase） */
import { ApiError } from '../errors'
import type { ProfileStats } from '../mock/users'
import type { Appeal, Profile, Restriction, UserSettings } from '../../types'
import { LIMITS } from '../../constants'
import { activeRestrictions } from '../../restrictions'
import { emit, profiles, putProfiles, state } from './store'
import { capsOf, loadMe, requireCap, requireUser, rpc, run, sb } from './core'
import { PROFILE_COLS, profilePatch, settingsPatch, toAppeal, toProfile, toRestriction, toSettings } from './mappers'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>

/** 同期で求められたプロフィールを裏で読み、届いたら画面に知らせる */
const requested = new Set<string>()
export function ensureProfiles(ids: (string | null | undefined)[]) {
  const missing = [...new Set(ids.filter((id): id is string => !!id && !profiles.has(id) && !requested.has(id)))]
  if (!missing.length) return
  for (const id of missing) requested.add(id)
  void sb()
    .from('profiles')
    .select(PROFILE_COLS)
    .in('id', missing)
    .then(({ data }) => {
      if (data?.length) {
        putProfiles(data.map(toProfile))
        emit()
      }
    })
}

/** プロフィールを読む（他の人が名前やアイコンを変えることがあるので、毎回サーバーから読み直す） */
export async function fetchProfiles(ids: string[]): Promise<Profile[]> {
  const need = [...new Set(ids.filter(Boolean))]
  if (need.length) {
    const rows = await run(sb().from('profiles').select(PROFILE_COLS).in('id', need))
    putProfiles((rows as Row[]).map(toProfile))
  }
  return ids.map((id) => profiles.get(id)).filter((p): p is Profile => !!p)
}

export const users = {
  me(): Profile | null {
    return state.me
  },

  async getProfile(id: string): Promise<Profile | null> {
    const row = await run(sb().from('profiles').select(PROFILE_COLS).eq('id', id).maybeSingle())
    const p = row ? toProfile(row) : null
    putProfiles([p])
    return p
  },

  profileSync(id: string): Profile | undefined {
    const p = profiles.get(id)
    if (!p) ensureProfiles([id])
    return p
  },

  async getProfileByHandle(handle: string): Promise<Profile | null> {
    const h = handle.replace(/^@/, '')
    const row = await run(sb().from('profiles').select(PROFILE_COLS).ilike('handle', h.replace(/[%_]/g, '\\$&')).maybeSingle())
    const p = row ? toProfile(row) : null
    putProfiles([p])
    return p
  },

  async updateProfile(patch: Partial<Profile>): Promise<Profile> {
    const me = requireUser()
    if (patch.displayName !== undefined) {
      const v = patch.displayName.trim()
      if (!v) throw new ApiError('invalid', '表示名を入力してください')
      if (v.length > LIMITS.displayName) throw new ApiError('invalid', `表示名は${LIMITS.displayName}文字以内で入力してください`)
      patch.displayName = v
    }
    if (patch.bio !== undefined && patch.bio.length > LIMITS.bio) throw new ApiError('invalid', `自己紹介は${LIMITS.bio}文字以内で入力してください`)
    if (patch.skills && patch.skills.length > LIMITS.skills) throw new ApiError('invalid', `スキルタグは${LIMITS.skills}個までです`)
    if (patch.links && patch.links.length > LIMITS.links) throw new ApiError('invalid', `外部リンクは${LIMITS.links}個までです`)
    const row = profilePatch(patch)
    if (Object.keys(row).length) await run(sb().from('profiles').update(row).eq('id', me.id))
    const next = { ...me, ...patch }
    state.me = next
    putProfiles([next])
    emit()
    return next
  },

  async stats(userId: string): Promise<ProfileStats> {
    const s = await rpc<Row>('profile_stats', { p_user: userId })
    return { workCount: Number(s.work_count ?? 0), likeTotal: Number(s.like_total ?? 0), avgReplyMs: s.avg_reply_ms == null ? null : Number(s.avg_reply_ms) }
  },

  async search(q: string): Promise<Profile[]> {
    const text = q.trim()
    if (!text) return []
    const like = `%${text.replace(/[%_,()]/g, '')}%`
    const rows = await run(sb().from('profiles').select(PROFILE_COLS).eq('is_official', false).or(`display_name.ilike.${like},handle.ilike.${like}`).limit(30))
    const list = (rows as Row[]).map(toProfile)
    putProfiles(list)
    return list
  },

  async featuredCreators(): Promise<{ profile: Profile; likes7d: number }[]> {
    const rows = await rpc<Row[]>('featured_creators')
    const list = rows.map((r) => ({ profile: toProfile(r.profile), likes7d: Number(r.likes7d) }))
    putProfiles(list.map((x) => x.profile))
    return list
  },

  // ---- 設定 ----
  settings(): UserSettings | null {
    return state.settings
  },

  async updateSettings(patch: Partial<Omit<UserSettings, 'userId'>>): Promise<UserSettings> {
    const me = requireUser()
    const cur = state.settings
    if (!cur) throw new ApiError('not_found', '設定が見つかりません')
    if (patch.notify) patch.notify = { ...cur.notify, ...patch.notify, important: true } // 重要なお知らせはオフにできない
    const next = { ...cur, ...patch }
    state.settings = next
    emit()
    const row = await run(sb().from('user_settings').update(settingsPatch(patch)).eq('user_id', me.id).select().single())
    state.settings = toSettings(row)
    emit()
    return state.settings
  },

  // ---- つながり（ZS-SOC） ----
  async friends(): Promise<Profile[]> {
    const me = requireUser()
    const rows = await run(sb().from('friendships').select('friend_id,hidden').eq('user_id', me.id).eq('hidden', false))
    const list = await fetchProfiles((rows as Row[]).map((r) => r.friend_id))
    return list.filter((p) => !p.deletedAt)
  },

  /** あなたを追加したユーザー（自分は未追加） */
  async addedMe(): Promise<Profile[]> {
    const me = requireUser()
    const rows = await run(sb().from('friendships').select('user_id').eq('friend_id', me.id))
    const mine = new Set(state.friendships.filter((f) => f.userId === me.id).map((f) => f.friendId))
    const ids = (rows as Row[]).map((r) => r.user_id).filter((id: string) => !mine.has(id) && !state.blocks.has(id))
    return fetchProfiles(ids)
  },

  relation(userId: string): { friend: boolean; addedMe: boolean; blocked: boolean; hidden: boolean } {
    const me = state.me
    if (!me) return { friend: false, addedMe: false, blocked: false, hidden: false }
    const f = state.friendships.find((x) => x.userId === me.id && x.friendId === userId)
    return {
      friend: !!f,
      hidden: !!f?.hidden,
      addedMe: state.friendships.some((x) => x.userId === userId && x.friendId === me.id),
      blocked: state.blocks.has(userId),
    }
  },

  async addFriend(userId: string): Promise<void> {
    const me = requireUser()
    requireCap('canAddFriend', '現在、友だち追加は制限されています')
    if (userId === me.id) throw new ApiError('invalid', '自分は追加できません')
    if (state.blocks.has(userId)) throw new ApiError('blocked', 'このユーザーは追加できません')
    if (state.friendships.some((f) => f.userId === me.id && f.friendId === userId)) return
    const { error } = await sb().from('friendships').insert({ user_id: me.id, friend_id: userId })
    if (error && error.code !== '23505') throw new ApiError('blocked', 'このユーザーは追加できません')
    state.friendships = [...state.friendships, { userId: me.id, friendId: userId, hidden: false, createdAt: new Date().toISOString() }]
    emit()
  },

  async removeFriend(userId: string): Promise<void> {
    const me = requireUser()
    await run(sb().from('friendships').delete().eq('user_id', me.id).eq('friend_id', userId))
    state.friendships = state.friendships.filter((f) => !(f.userId === me.id && f.friendId === userId))
    emit()
  },

  /** ZS-SOC-05 非表示（ブロックより弱い） */
  async setHidden(userId: string, hidden: boolean): Promise<void> {
    const me = requireUser()
    await run(sb().from('friendships').update({ hidden }).eq('user_id', me.id).eq('friend_id', userId))
    state.friendships = state.friendships.map((f) => (f.userId === me.id && f.friendId === userId ? { ...f, hidden } : f))
    emit()
  },

  async block(userId: string): Promise<void> {
    const me = requireUser()
    const { error } = await sb().from('blocks').insert({ blocker_id: me.id, blocked_id: userId })
    if (error && error.code !== '23505') throw new ApiError('invalid', 'ブロックできませんでした')
    state.blocks = new Set([...state.blocks, userId])
    state.friendships = state.friendships.filter((f) => !(f.userId === me.id && f.friendId === userId))
    emit()
  },

  async unblock(userId: string): Promise<void> {
    const me = requireUser()
    await run(sb().from('blocks').delete().eq('blocker_id', me.id).eq('blocked_id', userId))
    const next = new Set(state.blocks)
    next.delete(userId)
    state.blocks = next
    emit()
  },

  async blockedUsers(): Promise<Profile[]> {
    requireUser()
    // ブロックした相手のプロフィールは RLS で見えなくなることがあるため、運営用ではなく本人の一覧として ID から読む
    return fetchProfiles([...state.blocks])
  },

  /** ZS-SOC-06 知り合いかも */
  async suggestions(): Promise<Profile[]> {
    requireUser()
    const rows = await rpc<Row[]>('friend_suggestions')
    const list = rows.map(toProfile)
    putProfiles(list)
    return list
  },

  // ---- 利用制限（本人向け） ----
  myRestrictions(): Restriction[] {
    return activeRestrictions(state.restrictions)
  },

  myCapabilities() {
    return state.me ? capsOf() : null
  },

  async submitAppeal(restrictionId: string, body: string): Promise<void> {
    requireUser()
    if (!body.trim()) throw new ApiError('invalid', '申し立ての内容を入力してください')
    await rpc('submit_appeal', { p_restriction: restrictionId, p_body: body })
    const rows = await run(sb().from('appeals').select('*').order('created_at', { ascending: false }))
    state.appeals = (rows as Row[]).map(toAppeal)
    emit()
  },

  myAppeals(): Appeal[] {
    return state.appeals
  },
}

/** 制限の変化（Realtime）や運営の操作のあとで、本人の制限を読み直す */
export async function refreshRestrictions() {
  const rows = await rpc<Row[]>('my_restrictions')
  state.restrictions = rows.map(toRestriction)
  emit()
}

export { loadMe }
