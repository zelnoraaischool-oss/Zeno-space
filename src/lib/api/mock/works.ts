/**
 * 7章 ショーケース。
 * 本番の一覧・件数・絞り込みは RPC `search_works()`（PGroonga）で行い、
 * Worker 経由で60秒キャッシュする（17.5）。
 */
import { ApiError } from '../errors'
import { db, delay, done, currentUser, requireUser, requireCap, profileOf, notify, isBlockedBetween } from './core'
import { matchesSearch, normalizeSearch } from '../../normalize'
import { nowIso, uuid } from '../../ids'
import { LIMITS } from '../../constants'
import type { Collection, Master, Profile, SavedSearch, Work, WorkDailyStat, WorkMedia, WorkQuery, WorkType } from '../../types'

export interface WorkWithOwner {
  work: Work
  owner: Profile
}

export interface Facets {
  types: Record<string, number>
  categories: Record<string, number>
  techs: Record<string, number>
  productionTypes: Record<string, number>
  openOnly: number
}

function isPubliclyListed(w: Work): boolean {
  return w.status === 'active' && w.visibility === 'public' && !!w.publishedAt && !w.deletedAt
}

function textOf(w: Work, owner: Profile | undefined, d = db()): string {
  const cat = d.categories.find((c) => c.id === w.categoryId)?.name ?? ''
  const techs = w.techIds.map((id) => d.techs.find((t) => t.id === id)?.name ?? '').join(' ')
  return `${w.title} ${w.catchCopy} ${w.description} ${w.tags.join(' ')} ${cat} ${techs} ${owner?.displayName ?? ''} ${owner?.handle ?? ''}`
}

function applyQuery(list: Work[], q: WorkQuery, skip?: keyof WorkQuery): Work[] {
  const d = db()
  const viewer = currentUser()?.id
  return list.filter((w) => {
    const owner = profileOf(w.ownerId)
    if (!owner || owner.status === 'banned' || owner.deletedAt) return false
    if (viewer && isBlockedBetween(viewer, w.ownerId)) return false
    if (q.ownerId && w.ownerId !== q.ownerId) return false
    if (skip !== 'types' && q.types?.length && !q.types.includes(w.type)) return false
    if (skip !== 'categoryIds' && q.categoryIds?.length && !q.categoryIds.includes(w.categoryId ?? '')) return false
    if (skip !== 'techIds' && q.techIds?.length && !q.techIds.some((t) => w.techIds.includes(t))) return false
    if (skip !== 'productionTypes' && q.productionTypes?.length && !q.productionTypes.includes(w.productionType!)) return false
    if (q.tags?.length && !q.tags.some((t) => w.tags.map(normalizeSearch).includes(normalizeSearch(t)))) return false
    if (q.priceMin != null && (w.priceMax ?? w.priceMin ?? -1) < q.priceMin) return false
    if (q.priceMax != null && (w.priceMin ?? Infinity) > q.priceMax) return false
    if (skip !== 'openOnly' && q.openOnly && owner.commissionStatus !== 'open') return false
    if (q.q && !matchesSearch(textOf(w, owner, d), q.q)) return false
    return true
  })
}

function popularity(w: Work): number {
  const since = Date.now() - 7 * 86400_000
  return db()
    .workDailyStats.filter((s) => s.workId === w.id && new Date(s.date).getTime() >= since)
    .reduce((n, s) => n + s.likes, 0)
}

function sortWorks(list: Work[], sort: WorkQuery['sort'] = 'new'): Work[] {
  const arr = [...list]
  switch (sort) {
    case 'popular': {
      const pop = new Map(arr.map((w) => [w.id, popularity(w)]))
      return arr.sort((a, b) => pop.get(b.id)! - pop.get(a.id)!)
    }
    case 'likes':
      return arr.sort((a, b) => b.likeCount - a.likeCount)
    case 'views':
      return arr.sort((a, b) => b.viewCount - a.viewCount)
    default:
      return arr.sort((a, b) => ((a.publishedAt ?? '') < (b.publishedAt ?? '') ? 1 : -1))
  }
}

function withOwner(list: Work[]): WorkWithOwner[] {
  return list.map((work) => ({ work, owner: profileOf(work.ownerId)! })).filter((x) => x.owner)
}

function canEdit(w: Work, userId: string) {
  return w.ownerId === userId
}

export const works = {
  async list(q: WorkQuery, page: { offset: number; limit: number } = { offset: 0, limit: 24 }): Promise<{ items: WorkWithOwner[]; total: number }> {
    const filtered = sortWorks(applyQuery(db().works.filter(isPubliclyListed), q), q.sort)
    return delay({ items: withOwner(filtered.slice(page.offset, page.offset + page.limit)), total: filtered.length })
  },

  async count(q: WorkQuery): Promise<number> {
    return delay(applyQuery(db().works.filter(isPubliclyListed), q).length, 60)
  },

  /** 絞り込みシートの選択肢ごとの該当件数（0件は薄く表示：14.3） */
  async facets(q: WorkQuery): Promise<Facets> {
    const all = db().works.filter(isPubliclyListed)
    const tally = (list: Work[], key: (w: Work) => string[]) => {
      const out: Record<string, number> = {}
      for (const w of list) for (const k of key(w)) out[k] = (out[k] ?? 0) + 1
      return out
    }
    return delay(
      {
        types: tally(applyQuery(all, q, 'types'), (w) => [w.type]),
        categories: tally(applyQuery(all, q, 'categoryIds'), (w) => (w.categoryId ? [w.categoryId] : [])),
        techs: tally(applyQuery(all, q, 'techIds'), (w) => w.techIds),
        productionTypes: tally(applyQuery(all, q, 'productionTypes'), (w) => (w.productionType ? [w.productionType] : [])),
        openOnly: applyQuery(all, { ...q, openOnly: true }).length,
      },
      60,
    )
  },

  /** 0件のとき、外すと件数が増える条件を提案する */
  async relaxSuggestions(q: WorkQuery): Promise<{ key: keyof WorkQuery; label: string; count: number }[]> {
    const all = db().works.filter(isPubliclyListed)
    const out: { key: keyof WorkQuery; label: string; count: number }[] = []
    const tryWithout = (key: keyof WorkQuery, label: string) => {
      const next = { ...q, [key]: undefined }
      const n = applyQuery(all, next).length
      if (n > 0) out.push({ key, label, count: n })
    }
    if (q.openOnly) tryWithout('openOnly', '受付中のみ')
    if (q.types?.length) tryWithout('types', '種類')
    if (q.categoryIds?.length) tryWithout('categoryIds', 'カテゴリ')
    if (q.techIds?.length) tryWithout('techIds', '使用技術')
    if (q.productionTypes?.length) tryWithout('productionTypes', '制作形態')
    if (q.priceMin != null || q.priceMax != null) {
      const n = applyQuery(all, { ...q, priceMin: undefined, priceMax: undefined }).length
      if (n) out.push({ key: 'priceMin', label: '参考価格帯', count: n })
    }
    if (q.q) tryWithout('q', `「${q.q}」`)
    return delay(out.sort((a, b) => b.count - a.count))
  },

  async get(id: string): Promise<WorkWithOwner | null> {
    const d = db()
    const w = d.works.find((x) => x.id === id)
    const viewer = currentUser()?.id
    if (!w || w.deletedAt) return delay(null)
    const owner = profileOf(w.ownerId)
    if (!owner) return delay(null)
    const own = viewer === w.ownerId
    // 限定公開は URL を知る人なら見られる。下書き・非公開化は本人のみ
    if (!own && (w.status !== 'active' || w.visibility === 'draft')) return delay(null)
    if (!own && viewer && isBlockedBetween(viewer, owner.id)) return delay(null)
    return delay({ work: w, owner })
  },

  workSync(id: string): Work | undefined {
    return db().works.find((w) => w.id === id)
  },

  async recordView(id: string): Promise<void> {
    const d = db()
    const w = d.works.find((x) => x.id === id)
    const me = currentUser()
    if (!w || w.ownerId === me?.id) return
    w.viewCount += 1
    const today = new Date().toISOString().slice(0, 10)
    const stat = d.workDailyStats.find((s) => s.workId === id && s.date === today)
    if (stat) stat.views += 1
    else d.workDailyStats.push({ workId: id, date: today, views: 1, likes: 0, inquiries: 0 })
    if (me) {
      // ZS-WORK-15 閲覧履歴（最大100件）
      d.viewHistory = d.viewHistory.filter((v) => !(v.userId === me.id && v.workId === id))
      d.viewHistory.unshift({ userId: me.id, workId: id, viewedAt: nowIso() })
      const mine = d.viewHistory.filter((v) => v.userId === me.id)
      if (mine.length > LIMITS.viewHistory) {
        const drop = new Set(mine.slice(LIMITS.viewHistory))
        d.viewHistory = d.viewHistory.filter((v) => !drop.has(v))
      }
    }
    done(undefined)
  },

  likedIds(): Set<string> {
    const me = currentUser()
    if (!me) return new Set()
    return new Set(
      db()
        .likes.filter((l) => l.userId === me.id)
        .map((l) => l.workId),
    )
  },

  async setLike(workId: string, liked: boolean): Promise<{ liked: boolean; likeCount: number }> {
    const me = requireUser()
    const d = db()
    const w = d.works.find((x) => x.id === workId)
    if (!w) throw new ApiError('not_found', '作品が見つかりません')
    const has = d.likes.some((l) => l.userId === me.id && l.workId === workId)
    if (liked && !has) {
      d.likes.push({ userId: me.id, workId, createdAt: nowIso() })
      w.likeCount += 1
      const today = new Date().toISOString().slice(0, 10)
      const stat = d.workDailyStats.find((s) => s.workId === workId && s.date === today)
      if (stat) stat.likes += 1
      else d.workDailyStats.push({ workId, date: today, views: 0, likes: 1, inquiries: 0 })
      if (w.ownerId !== me.id) notify(w.ownerId, 'like', { actorId: me.id, target: `/works/${workId}`, text: `「${w.title}」に{n}件のいいね`, group: true })
    } else if (!liked && has) {
      d.likes = d.likes.filter((l) => !(l.userId === me.id && l.workId === workId))
      w.likeCount = Math.max(0, w.likeCount - 1)
      for (const c of d.collections.filter((c) => c.userId === me.id)) c.workIds = c.workIds.filter((id) => id !== workId)
    }
    return done({ liked, likeCount: w.likeCount })
  },

  async liked(): Promise<WorkWithOwner[]> {
    const me = requireUser()
    const d = db()
    const ids = d.likes
      .filter((l) => l.userId === me.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((l) => l.workId)
    return delay(withOwner(ids.map((id) => d.works.find((w) => w.id === id)).filter((w): w is Work => !!w && w.status === 'active')))
  },

  async history(): Promise<WorkWithOwner[]> {
    const me = requireUser()
    const d = db()
    const list = d.viewHistory
      .filter((v) => v.userId === me.id)
      .map((v) => d.works.find((w) => w.id === v.workId))
      .filter((w): w is Work => !!w && w.status === 'active')
    return delay(withOwner(list))
  },

  async clearHistory(): Promise<void> {
    const me = requireUser()
    db().viewHistory = db().viewHistory.filter((v) => v.userId !== me.id)
    return done(undefined)
  },

  // ---- コレクション（ZS-WORK-14） ----
  async collections(): Promise<Collection[]> {
    const me = requireUser()
    return delay(db().collections.filter((c) => c.userId === me.id))
  },
  async createCollection(name: string): Promise<Collection> {
    const me = requireUser()
    if (!name.trim()) throw new ApiError('invalid', 'コレクション名を入力してください')
    const c: Collection = { id: uuid(), userId: me.id, name: name.trim().slice(0, 30), workIds: [], createdAt: nowIso() }
    db().collections.push(c)
    return done(c)
  },
  async renameCollection(id: string, name: string): Promise<void> {
    const me = requireUser()
    const c = db().collections.find((x) => x.id === id && x.userId === me.id)
    if (c) c.name = name.slice(0, 30)
    return done(undefined)
  },
  async deleteCollection(id: string): Promise<void> {
    const me = requireUser()
    db().collections = db().collections.filter((c) => !(c.id === id && c.userId === me.id))
    return done(undefined)
  },
  async toggleInCollection(collectionId: string, workId: string): Promise<void> {
    const me = requireUser()
    const c = db().collections.find((x) => x.id === collectionId && x.userId === me.id)
    if (!c) throw new ApiError('not_found', 'コレクションが見つかりません')
    c.workIds = c.workIds.includes(workId) ? c.workIds.filter((x) => x !== workId) : [...c.workIds, workId]
    return done(undefined)
  },

  // ---- 投稿・編集（ZS-WORK-01〜05） ----
  async createDraft(type: WorkType): Promise<Work> {
    const me = requireUser()
    requireCap(me.id, 'canPostWork', '現在、作品の投稿は制限されています')
    const d = db()
    // 3.3.7 同じ入力を求めない：前回の使用技術を引き継ぐ
    const last = d.works.filter((w) => w.ownerId === me.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
    const ts = nowIso()
    const w: Work = {
      id: uuid(),
      ownerId: me.id,
      type,
      title: '',
      catchCopy: '',
      description: '',
      categoryId: null,
      techIds: last?.techIds ?? [],
      tags: [],
      productionType: null,
      roles: last?.roles ?? [],
      periodValue: null,
      periodUnit: null,
      priceMin: null,
      priceMax: null,
      url: '',
      storeUrl: '',
      videoUrl: '',
      visibility: 'draft',
      licenseConfirmed: false,
      status: 'active',
      hiddenReason: null,
      media: [],
      likeCount: 0,
      viewCount: 0,
      inquiryCount: 0,
      publishedAt: null,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    }
    d.works.push(w)
    return done(w)
  },

  async update(id: string, patch: Partial<Omit<Work, 'id' | 'ownerId' | 'likeCount' | 'viewCount' | 'status'>>): Promise<Work> {
    const me = requireUser()
    requireCap(me.id, 'canPostWork', '現在、作品の投稿と編集は制限されています')
    const w = db().works.find((x) => x.id === id)
    if (!w || !canEdit(w, me.id)) throw new ApiError('not_found', '作品が見つかりません')
    if (patch.title !== undefined && patch.title.length > LIMITS.workTitle)
      throw new ApiError('invalid', `タイトルは${LIMITS.workTitle}文字以内で入力してください`)
    if (patch.catchCopy !== undefined && patch.catchCopy.length > LIMITS.catchCopy)
      throw new ApiError('invalid', `キャッチコピーは${LIMITS.catchCopy}文字以内で入力してください`)
    if (patch.description !== undefined && patch.description.length > LIMITS.description)
      throw new ApiError('invalid', `説明は${LIMITS.description.toLocaleString()}文字以内で入力してください`)
    if (patch.media && patch.media.length > LIMITS.galleryImages + 1) throw new ApiError('invalid', '画像は10枚までです')
    Object.assign(w, patch, { updatedAt: nowIso() })
    return done(w)
  },

  /** 公開前の検証（7.2 掲載項目の必須チェック） */
  validate(w: Work): string[] {
    const errs: string[] = []
    if (!w.title.trim()) errs.push('タイトル')
    if (!w.media.length) errs.push(w.type === 'image' ? '画像（1枚以上）' : 'サムネイル')
    if ((w.type === 'hp' || w.type === 'lp') && !w.url) errs.push('公開URL')
    if (w.type === 'app' && !w.storeUrl && !w.url) errs.push('ストアURLまたはWeb URL')
    if (w.type === 'video' && !/^(https:\/\/)(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\//.test(w.videoUrl)) errs.push('動画URL（YouTube / Vimeo）')
    if (!w.categoryId) errs.push('カテゴリ')
    if (!w.productionType) errs.push('制作形態')
    if (w.productionType === 'client' && !w.licenseConfirmed) errs.push('クライアントの掲載許諾の確認')
    return errs
  },

  async publish(id: string, visibility: 'public' | 'unlisted'): Promise<Work> {
    const me = requireUser()
    requireCap(me.id, 'canPostWork', '現在、作品の投稿は制限されています')
    const d = db()
    const w = d.works.find((x) => x.id === id)
    if (!w || !canEdit(w, me.id)) throw new ApiError('not_found', '作品が見つかりません')
    const errs = works.validate(w)
    if (errs.length) throw new ApiError('invalid', `次の項目を入力してください：${errs.join('、')}`)
    w.visibility = visibility
    w.publishedAt ??= nowIso()
    w.updatedAt = nowIso()
    if (visibility === 'public') notifySavedSearches(w)
    return done(w)
  },

  async setVisibility(id: string, visibility: Work['visibility']): Promise<void> {
    const me = requireUser()
    const w = db().works.find((x) => x.id === id)
    if (!w || !canEdit(w, me.id)) throw new ApiError('not_found', '作品が見つかりません')
    w.visibility = visibility
    return done(undefined)
  },

  /** 削除した作品は30日間ゴミ箱に残す（ZS-WORK-05） */
  async trash(id: string): Promise<void> {
    const me = requireUser()
    const w = db().works.find((x) => x.id === id)
    if (!w || !canEdit(w, me.id)) throw new ApiError('not_found', '作品が見つかりません')
    w.status = 'trashed'
    w.deletedAt = nowIso()
    return done(undefined)
  },

  async restore(id: string): Promise<void> {
    const me = requireUser()
    const w = db().works.find((x) => x.id === id)
    if (!w || !canEdit(w, me.id)) throw new ApiError('not_found', '作品が見つかりません')
    w.status = 'active'
    w.deletedAt = null
    return done(undefined)
  },

  async mine(): Promise<Work[]> {
    const me = requireUser()
    return delay(
      db()
        .works.filter((w) => w.ownerId === me.id)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    )
  },

  async insights(id: string): Promise<WorkDailyStat[]> {
    const me = requireUser()
    const w = db().works.find((x) => x.id === id)
    if (!w || w.ownerId !== me.id) throw new ApiError('not_found', '作品が見つかりません')
    return delay(
      db()
        .workDailyStats.filter((s) => s.workId === id)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .slice(-30),
    )
  },

  async related(id: string): Promise<{ sameOwner: WorkWithOwner[]; similar: WorkWithOwner[] }> {
    const d = db()
    const w = d.works.find((x) => x.id === id)
    if (!w) return delay({ sameOwner: [], similar: [] })
    const pool = applyQuery(d.works.filter(isPubliclyListed), {}).filter((x) => x.id !== id)
    const sameOwner = pool.filter((x) => x.ownerId === w.ownerId).slice(0, 6)
    const similar = pool
      .filter((x) => x.ownerId !== w.ownerId)
      .map((x) => ({
        x,
        s:
          (x.categoryId === w.categoryId ? 2 : 0) +
          x.tags.filter((t) => w.tags.includes(t)).length +
          x.techIds.filter((t) => w.techIds.includes(t)).length +
          (x.type === w.type ? 1 : 0),
      }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((x) => x.x)
    return delay({ sameOwner: withOwner(sameOwner), similar: withOwner(similar) })
  },

  async pickups(): Promise<WorkWithOwner[]> {
    const d = db()
    return delay(withOwner(d.pickups.map((id) => d.works.find((w) => w.id === id)).filter((w): w is Work => !!w && isPubliclyListed(w))))
  },

  /** ZS-HOME-04 興味タグといいね履歴からタグの一致度で選ぶ */
  async recommended(page: { offset: number; limit: number }): Promise<{ items: WorkWithOwner[]; total: number }> {
    const me = currentUser()
    const d = db()
    const pool = applyQuery(d.works.filter(isPubliclyListed), {}).filter((w) => w.ownerId !== me?.id)
    const interest = new Set((me?.interests ?? []).map(normalizeSearch))
    const likedTags = new Map<string, number>()
    if (me)
      for (const l of d.likes.filter((l) => l.userId === me.id)) {
        const w = d.works.find((x) => x.id === l.workId)
        for (const t of [...(w?.tags ?? []), d.categories.find((c) => c.id === w?.categoryId)?.name ?? ''])
          likedTags.set(normalizeSearch(t), (likedTags.get(normalizeSearch(t)) ?? 0) + 1)
      }
    const scored = pool
      .map((w) => {
        const keys = [
          ...w.tags,
          d.categories.find((c) => c.id === w.categoryId)?.name ?? '',
          ...w.techIds.map((t) => d.techs.find((x) => x.id === t)?.name ?? ''),
        ].map(normalizeSearch)
        const s = keys.reduce((n, k) => n + (likedTags.get(k) ?? 0) + ([...interest].some((i) => k.includes(i) || i.includes(k)) ? 2 : 0), 0)
        return { w, s: s + w.likeCount / 500 }
      })
      .sort((a, b) => b.s - a.s)
      .map((x) => x.w)
    return delay({ items: withOwner(scored.slice(page.offset, page.offset + page.limit)), total: scored.length })
  },

  /**
   * ZS-WORK-02 URL から OGP を取得する。
   * 本番は Edge Function `og-fetch`（内部アドレス禁止・リダイレクト3回・5秒タイムアウト）。
   */
  async fetchOgp(url: string): Promise<{ title: string; description: string; image: string | null }> {
    let host: string
    try {
      const u = new URL(url)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error()
      host = u.hostname
    } catch {
      throw new ApiError('invalid', 'URLの形式が正しくありません')
    }
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) throw new ApiError('invalid', 'このURLは取得できません')
    const name = host.replace(/^www\./, '').split('.')[0]
    return delay({ title: `${name.charAt(0).toUpperCase()}${name.slice(1)} 公式サイト`, description: `${host} のトップページです。`, image: null }, 600)
  },

  // ---- マスタ ----
  categories(): Master[] {
    return [...db().categories].sort((a, b) => a.sortOrder - b.sortOrder)
  },
  techs(): Master[] {
    return [...db().techs].sort((a, b) => a.sortOrder - b.sortOrder)
  },
  popularTags(): string[] {
    const count = new Map<string, number>()
    for (const w of db().works.filter(isPubliclyListed)) for (const t of w.tags) count.set(t, (count.get(t) ?? 0) + 1)
    return [...count.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t)
      .slice(0, 30)
  },

  // ---- 検索条件の保存（ZS-WORK-09）・検索履歴（ZS-SRCH-04） ----
  async savedSearches(): Promise<SavedSearch[]> {
    const me = requireUser()
    return delay(db().savedSearches.filter((s) => s.userId === me.id))
  },
  async saveSearch(name: string, query: WorkQuery, notifyNew: boolean): Promise<SavedSearch> {
    const me = requireUser()
    if (!name.trim()) throw new ApiError('invalid', '名前を入力してください')
    const s: SavedSearch = { id: uuid(), userId: me.id, name: name.trim().slice(0, 30), query, notify: notifyNew, lastNotifiedAt: null, createdAt: nowIso() }
    db().savedSearches.push(s)
    return done(s)
  },
  async updateSavedSearch(id: string, patch: { notify?: boolean; name?: string }): Promise<void> {
    const me = requireUser()
    const s = db().savedSearches.find((x) => x.id === id && x.userId === me.id)
    if (s) Object.assign(s, patch)
    return done(undefined)
  },
  async deleteSavedSearch(id: string): Promise<void> {
    const me = requireUser()
    db().savedSearches = db().savedSearches.filter((s) => !(s.id === id && s.userId === me.id))
    return done(undefined)
  },
  searchHistory(): string[] {
    const me = currentUser()
    if (!me) return []
    return db()
      .searchHistory.filter((h) => h.userId === me.id)
      .map((h) => h.q)
      .slice(0, 10)
  },
  recordSearch(q: string) {
    const me = currentUser()
    if (!me || !q.trim()) return
    const d = db()
    d.searchHistory = [{ userId: me.id, q: q.trim(), at: nowIso() }, ...d.searchHistory.filter((h) => !(h.userId === me.id && h.q === q.trim()))].slice(0, 200)
    done(undefined)
  },
  removeSearchHistory(q: string) {
    const me = currentUser()
    if (!me) return
    db().searchHistory = db().searchHistory.filter((h) => !(h.userId === me.id && h.q === q))
    done(undefined)
  },
}

/** 保存した検索条件に合う新着を通知する（本番は pg_cron で毎日8:00にまとめる） */
function notifySavedSearches(w: Work) {
  const d = db()
  for (const s of d.savedSearches.filter((s) => s.notify && s.userId !== w.ownerId)) {
    if (applyQuery([w], s.query).length)
      notify(s.userId, 'saved_search', { target: `/works/${w.id}`, text: `保存した条件「${s.name}」に新着作品があります`, group: true })
  }
}

export type { WorkMedia }
