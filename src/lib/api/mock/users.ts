/** 5.3 プロフィール、5.4 つながり、8.4 設定 */
import { ApiError } from '../errors'
import { db, delay, done, currentUser, requireUser, profileOf, isBlockedBetween, hasBlocked, requireCap, notify, capsOf } from './core'
import { matchesSearch } from '../../normalize'
import { nowIso } from '../../ids'
import { LIMITS } from '../../constants'
import type { Profile, UserSettings } from '../../types'
import { activeRestrictions } from '../../restrictions'

export interface ProfileStats {
  workCount: number
  likeTotal: number
  avgReplyMs: number | null
}

/** 他人に見せるプロフィール（未ログイン・公開範囲・ブロックを考慮） */
function visibleProfile(p: Profile | undefined, viewerId: string | null): Profile | null {
  if (!p || p.deletedAt) return null
  if (p.status === 'banned') return null
  if (viewerId && hasBlocked(p.id, viewerId)) return null // ZS-SOC-04 ブロックした相手はプロフィールを見られない
  if (!viewerId && p.profileVisibility === 'members') return null
  return p
}

export const users = {
  me(): Profile | null {
    return currentUser()
  },

  async getProfile(id: string): Promise<Profile | null> {
    return delay(visibleProfile(profileOf(id), currentUser()?.id ?? null))
  },

  profileSync(id: string): Profile | undefined {
    return profileOf(id)
  },

  async getProfileByHandle(handle: string): Promise<Profile | null> {
    const p = db().profiles.find((x) => x.handle.toLowerCase() === handle.replace(/^@/, '').toLowerCase())
    return delay(visibleProfile(p, currentUser()?.id ?? null))
  },

  async updateProfile(
    patch: Partial<
      Pick<
        Profile,
        | 'displayName'
        | 'avatarUrl'
        | 'avatarColor'
        | 'coverUrl'
        | 'bio'
        | 'skills'
        | 'links'
        | 'prefecture'
        | 'commissionStatus'
        | 'dmPolicy'
        | 'profileVisibility'
        | 'interests'
        | 'onboarded'
      >
    >,
  ): Promise<Profile> {
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
    Object.assign(me, patch)
    return done(me)
  },

  async stats(userId: string): Promise<ProfileStats> {
    const d = db()
    const works = d.works.filter((w) => w.ownerId === userId && w.status === 'active' && w.visibility === 'public')
    const replies = d.inquiries
      .filter((i) => i.toUser === userId && i.firstReplyAt)
      .map((i) => new Date(i.firstReplyAt!).getTime() - new Date(i.createdAt).getTime())
      .sort((a, b) => a - b)
    const median = replies.length ? replies[Math.floor(replies.length / 2)] : null
    return delay({ workCount: works.length, likeTotal: works.reduce((s, w) => s + w.likeCount, 0), avgReplyMs: median })
  },

  async search(q: string): Promise<Profile[]> {
    const viewer = currentUser()?.id ?? null
    const res = db()
      .profiles.filter((p) => !p.isOfficial && matchesSearch(`${p.displayName} ${p.handle} ${p.skills.join(' ')}`, q))
      .map((p) => visibleProfile(p, viewer))
      .filter((p): p is Profile => !!p)
      .slice(0, 30)
    return delay(res)
  },

  async featuredCreators(): Promise<{ profile: Profile; likes7d: number }[]> {
    const d = db()
    const since = Date.now() - 7 * 86400_000
    const score = new Map<string, number>()
    for (const l of d.likes) {
      if (new Date(l.createdAt).getTime() < since) continue
      const w = d.works.find((x) => x.id === l.workId)
      if (w) score.set(w.ownerId, (score.get(w.ownerId) ?? 0) + 1)
    }
    // モックは実いいねが少ないため、直近7日の集計値で補う
    for (const s of d.workDailyStats.filter((s) => new Date(s.date).getTime() >= since)) {
      const w = d.works.find((x) => x.id === s.workId)
      if (w) score.set(w.ownerId, (score.get(w.ownerId) ?? 0) + s.likes)
    }
    const res = [...score.entries()]
      .map(([id, likes7d]) => ({ profile: profileOf(id)!, likes7d }))
      .filter((x) => x.profile && !x.profile.isOfficial && x.profile.status === 'active')
      .sort((a, b) => b.likes7d - a.likes7d)
      .slice(0, 8)
    return delay(res)
  },

  // ---- 設定 ----
  settings(): UserSettings | null {
    const me = currentUser()
    if (!me) return null
    return db().userSettings.find((s) => s.userId === me.id) ?? null
  },

  async updateSettings(patch: Partial<Omit<UserSettings, 'userId'>>): Promise<UserSettings> {
    const me = requireUser()
    const s = db().userSettings.find((x) => x.userId === me.id)!
    if (patch.notify) patch.notify = { ...s.notify, ...patch.notify, important: true } // 重要なお知らせはオフにできない
    Object.assign(s, patch)
    return done(s)
  },

  // ---- つながり（ZS-SOC） ----
  async friends(): Promise<Profile[]> {
    const me = requireUser()
    const d = db()
    return delay(
      d.friendships
        .filter((f) => f.userId === me.id && !f.hidden)
        .map((f) => profileOf(f.friendId))
        .filter((p): p is Profile => !!p && !p.deletedAt),
    )
  },

  /** あなたを追加したユーザー（自分は未追加） */
  async addedMe(): Promise<Profile[]> {
    const me = requireUser()
    const d = db()
    return delay(
      d.friendships
        .filter((f) => f.friendId === me.id && !d.friendships.some((x) => x.userId === me.id && x.friendId === f.userId))
        .map((f) => profileOf(f.userId))
        .filter((p): p is Profile => !!p && !hasBlocked(me.id, p.id)),
    )
  },

  relation(userId: string): { friend: boolean; addedMe: boolean; blocked: boolean; hidden: boolean } {
    const me = currentUser()
    if (!me) return { friend: false, addedMe: false, blocked: false, hidden: false }
    const d = db()
    const f = d.friendships.find((x) => x.userId === me.id && x.friendId === userId)
    return {
      friend: !!f,
      hidden: !!f?.hidden,
      addedMe: d.friendships.some((x) => x.userId === userId && x.friendId === me.id),
      blocked: hasBlocked(me.id, userId),
    }
  },

  async addFriend(userId: string): Promise<void> {
    const me = requireUser()
    requireCap(me.id, 'canAddFriend', '現在、友だち追加は制限されています')
    if (userId === me.id) throw new ApiError('invalid', '自分は追加できません')
    if (isBlockedBetween(me.id, userId)) throw new ApiError('blocked', 'このユーザーは追加できません')
    const d = db()
    if (!d.friendships.some((f) => f.userId === me.id && f.friendId === userId)) {
      d.friendships.push({ userId: me.id, friendId: userId, hidden: false, createdAt: nowIso() })
      notify(userId, 'friend', { actorId: me.id, target: `/u/${me.handle}`, text: `${me.displayName}さんがあなたを友だちに追加しました` })
    }
    return done(undefined)
  },

  async removeFriend(userId: string): Promise<void> {
    const me = requireUser()
    const d = db()
    d.friendships = d.friendships.filter((f) => !(f.userId === me.id && f.friendId === userId))
    return done(undefined)
  },

  /** ZS-SOC-05 非表示（ブロックより弱い） */
  async setHidden(userId: string, hidden: boolean): Promise<void> {
    const me = requireUser()
    const f = db().friendships.find((x) => x.userId === me.id && x.friendId === userId)
    if (f) f.hidden = hidden
    return done(undefined)
  },

  async block(userId: string): Promise<void> {
    const me = requireUser()
    const d = db()
    if (!d.blocks.some((b) => b.blockerId === me.id && b.blockedId === userId)) d.blocks.push({ blockerId: me.id, blockedId: userId, createdAt: nowIso() })
    d.friendships = d.friendships.filter((f) => !(f.userId === me.id && f.friendId === userId))
    return done(undefined)
  },

  async unblock(userId: string): Promise<void> {
    const me = requireUser()
    const d = db()
    d.blocks = d.blocks.filter((b) => !(b.blockerId === me.id && b.blockedId === userId))
    return done(undefined)
  },

  async blockedUsers(): Promise<Profile[]> {
    const me = requireUser()
    return delay(
      db()
        .blocks.filter((b) => b.blockerId === me.id)
        .map((b) => profileOf(b.blockedId))
        .filter((p): p is Profile => !!p),
    )
  },

  /** ZS-SOC-06 知り合いかも */
  async suggestions(): Promise<Profile[]> {
    const me = requireUser()
    const d = db()
    const myRooms = new Set(d.roomMembers.filter((m) => m.userId === me.id && m.state === 'active').map((m) => m.roomId))
    const groupRooms = d.rooms.filter((r) => r.kind === 'group' && myRooms.has(r.id)).map((r) => r.id)
    const ids = new Set(d.roomMembers.filter((m) => groupRooms.includes(m.roomId)).map((m) => m.userId))
    for (const f of d.friendships.filter((f) => f.friendId === me.id)) ids.add(f.userId)
    ids.delete(me.id)
    return delay(
      [...ids]
        .filter((id) => !d.friendships.some((f) => f.userId === me.id && f.friendId === id) && !isBlockedBetween(me.id, id))
        .map((id) => profileOf(id))
        .filter((p): p is Profile => !!p && !p.isOfficial),
    )
  },

  // ---- 利用制限（本人向け） ----
  myRestrictions() {
    const me = currentUser()
    if (!me) return []
    return activeRestrictions(db().restrictions.filter((r) => r.userId === me.id))
  },

  myCapabilities() {
    const me = currentUser()
    return me ? capsOf(me.id) : null
  },

  async submitAppeal(restrictionId: string, body: string): Promise<void> {
    const me = requireUser()
    const d = db()
    if (!d.restrictions.some((r) => r.id === restrictionId && r.userId === me.id)) throw new ApiError('not_found', '対象の制限が見つかりません')
    if (!body.trim()) throw new ApiError('invalid', '申し立ての内容を入力してください')
    d.appeals.unshift({ id: crypto.randomUUID(), restrictionId, userId: me.id, body, status: 'open', decidedBy: null, result: null, createdAt: nowIso() })
    return done(undefined)
  },

  myAppeals() {
    const me = currentUser()
    if (!me) return []
    return db().appeals.filter((a) => a.userId === me.id)
  },
}
