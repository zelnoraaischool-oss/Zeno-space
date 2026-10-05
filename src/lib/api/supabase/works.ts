/**
 * 7章 ショーケース（Supabase）。一覧・件数・絞り込みは search_works() / search_facets()（PGroonga）で行う。
 */
import { ApiError } from '../errors'
import type { Facets, WorkWithOwner } from '../mock/works'
import type { Collection, Master, SavedSearch, Work, WorkDailyStat, WorkQuery, WorkType } from '../../types'
import { LIMITS } from '../../constants'
import { emit, putWorks, state, works as workCache } from './store'
import { currentUser, requireCap, requireUser, rpc, run, sb } from './core'
import { fetchProfiles } from './users'
import { toCollection, toSavedSearch, toStat, toWork, WORK_SELECT, workPatch } from './mappers'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>

function queryJson(q: WorkQuery): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue
    out[k] = v
  }
  return out
}

/** ID の並びどおりに作品と制作者を読む */
async function hydrate(ids: string[]): Promise<WorkWithOwner[]> {
  if (!ids.length) return []
  const rows = (await run(sb().from('works').select(WORK_SELECT).in('id', ids))) as Row[]
  const list = rows.map(toWork)
  putWorks(list)
  const owners = await fetchProfiles([...new Set(list.map((w) => w.ownerId))])
  const omap = new Map(owners.map((p) => [p.id, p]))
  const wmap = new Map(list.map((w) => [w.id, w]))
  return ids
    .map((id) => wmap.get(id))
    .filter((w): w is Work => !!w)
    .map((work) => ({ work, owner: omap.get(work.ownerId)! }))
    .filter((x) => x.owner)
}

async function searchIds(q: WorkQuery, offset: number, limit: number): Promise<{ ids: string[]; total: number }> {
  const rows = await rpc<{ id: string; total: number }[]>('search_works', { p_query: queryJson(q), p_offset: offset, p_limit: limit })
  return { ids: rows.map((r) => r.id), total: rows.length ? Number(rows[0].total) : 0 }
}

const requestedWorks = new Set<string>()
function ensureWork(id: string) {
  if (!id || workCache.has(id) || requestedWorks.has(id)) return
  requestedWorks.add(id)
  void sb()
    .from('works')
    .select(WORK_SELECT)
    .eq('id', id)
    .maybeSingle()
    .then(({ data }) => {
      if (data) {
        putWorks([toWork(data)])
        emit()
      }
    })
}

export const works = {
  async list(q: WorkQuery, page: { offset: number; limit: number } = { offset: 0, limit: 24 }): Promise<{ items: WorkWithOwner[]; total: number }> {
    const { ids, total } = await searchIds(q, page.offset, page.limit)
    return { items: await hydrate(ids), total }
  },

  async count(q: WorkQuery): Promise<number> {
    const { total } = await searchIds(q, 0, 1)
    return total
  },

  /** 絞り込みシートの選択肢ごとの該当件数（0件は薄く表示：14.3） */
  async facets(q: WorkQuery): Promise<Facets> {
    const r = await rpc<Row>('search_facets', { p_query: queryJson(q) })
    return {
      types: r.types ?? {},
      categories: r.categories ?? {},
      techs: r.techs ?? {},
      productionTypes: r.productionTypes ?? {},
      openOnly: Number(r.openOnly ?? 0),
    }
  },

  /** 0件のとき、外すと件数が増える条件を提案する */
  async relaxSuggestions(q: WorkQuery): Promise<{ key: keyof WorkQuery; label: string; count: number }[]> {
    const tries: { key: keyof WorkQuery; label: string; next: WorkQuery }[] = []
    if (q.openOnly) tries.push({ key: 'openOnly', label: '受付中のみ', next: { ...q, openOnly: undefined } })
    if (q.types?.length) tries.push({ key: 'types', label: '種類', next: { ...q, types: undefined } })
    if (q.categoryIds?.length) tries.push({ key: 'categoryIds', label: 'カテゴリ', next: { ...q, categoryIds: undefined } })
    if (q.techIds?.length) tries.push({ key: 'techIds', label: '使用技術', next: { ...q, techIds: undefined } })
    if (q.productionTypes?.length) tries.push({ key: 'productionTypes', label: '制作形態', next: { ...q, productionTypes: undefined } })
    if (q.priceMin != null || q.priceMax != null) tries.push({ key: 'priceMin', label: '参考価格帯', next: { ...q, priceMin: undefined, priceMax: undefined } })
    if (q.q) tries.push({ key: 'q', label: `「${q.q}」`, next: { ...q, q: undefined } })
    const counts = await Promise.all(tries.map((t) => works.count(t.next)))
    return tries
      .map((t, i) => ({ key: t.key, label: t.label, count: counts[i] }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count)
  },

  async get(id: string): Promise<WorkWithOwner | null> {
    const row = await run(sb().from('works').select(WORK_SELECT).eq('id', id).maybeSingle())
    if (!row) return null
    const work = toWork(row)
    putWorks([work])
    const [owner] = await fetchProfiles([work.ownerId])
    if (!owner) return null
    const own = currentUser()?.id === work.ownerId
    if (!own && (work.status !== 'active' || work.visibility === 'draft' || work.deletedAt)) return null
    return { work, owner }
  },

  workSync(id: string): Work | undefined {
    const w = workCache.get(id)
    if (!w) ensureWork(id)
    return w
  },

  async recordView(id: string): Promise<void> {
    await sb().rpc('record_view', { p_work: id })
  },

  likedIds(): Set<string> {
    return state.likedIds
  },

  async setLike(workId: string, liked: boolean): Promise<{ liked: boolean; likeCount: number }> {
    const me = requireUser()
    const has = state.likedIds.has(workId)
    const w = workCache.get(workId)
    if (liked && !has) {
      state.likedIds = new Set([...state.likedIds, workId])
      if (w) workCache.set(workId, { ...w, likeCount: w.likeCount + 1 })
      emit()
      const { error } = await sb().from('likes').insert({ user_id: me.id, work_id: workId })
      if (error && error.code !== '23505') {
        state.likedIds.delete(workId)
        if (w) workCache.set(workId, w)
        emit()
        throw new ApiError('invalid', 'いいねできませんでした')
      }
    } else if (!liked && has) {
      const next = new Set(state.likedIds)
      next.delete(workId)
      state.likedIds = next
      if (w) workCache.set(workId, { ...w, likeCount: Math.max(0, w.likeCount - 1) })
      emit()
      await run(sb().from('likes').delete().eq('user_id', me.id).eq('work_id', workId))
      // いいねを外したらコレクションからも外す
      const cols = (await run(sb().from('collections').select('id').eq('user_id', me.id))) as Row[]
      if (cols.length)
        await sb()
          .from('collection_items')
          .delete()
          .eq('work_id', workId)
          .in(
            'collection_id',
            cols.map((c) => c.id),
          )
    }
    const fresh = await run(sb().from('works').select('like_count').eq('id', workId).maybeSingle())
    const likeCount = Number((fresh as Row | null)?.like_count ?? w?.likeCount ?? 0)
    const cur = workCache.get(workId)
    if (cur) workCache.set(workId, { ...cur, likeCount })
    emit()
    return { liked, likeCount }
  },

  async liked(): Promise<WorkWithOwner[]> {
    const me = requireUser()
    const rows = (await run(sb().from('likes').select('work_id').eq('user_id', me.id).order('created_at', { ascending: false }))) as Row[]
    return (await hydrate(rows.map((r) => r.work_id))).filter((x) => x.work.status === 'active')
  },

  async history(): Promise<WorkWithOwner[]> {
    const me = requireUser()
    const rows = (await run(sb().from('view_history').select('work_id').eq('user_id', me.id).order('viewed_at', { ascending: false }).limit(100))) as Row[]
    return (await hydrate(rows.map((r) => r.work_id))).filter((x) => x.work.status === 'active')
  },

  async clearHistory(): Promise<void> {
    const me = requireUser()
    await run(sb().from('view_history').delete().eq('user_id', me.id))
    emit()
  },

  // ---- コレクション（ZS-WORK-14） ----
  async collections(): Promise<Collection[]> {
    const me = requireUser()
    const rows = (await run(sb().from('collections').select('*,collection_items(work_id)').eq('user_id', me.id).order('created_at'))) as Row[]
    return rows.map(toCollection)
  },
  async createCollection(name: string): Promise<Collection> {
    const me = requireUser()
    if (!name.trim()) throw new ApiError('invalid', 'コレクション名を入力してください')
    const row = await run(
      sb()
        .from('collections')
        .insert({ user_id: me.id, name: name.trim().slice(0, 30) })
        .select('*')
        .single(),
    )
    emit()
    return toCollection(row)
  },
  async renameCollection(id: string, name: string): Promise<void> {
    await run(
      sb()
        .from('collections')
        .update({ name: name.slice(0, 30) })
        .eq('id', id),
    )
    emit()
  },
  async deleteCollection(id: string): Promise<void> {
    await run(sb().from('collections').delete().eq('id', id))
    emit()
  },
  async toggleInCollection(collectionId: string, workId: string): Promise<void> {
    requireUser()
    const has = (await run(sb().from('collection_items').select('work_id').eq('collection_id', collectionId).eq('work_id', workId))) as Row[]
    if (has.length) await run(sb().from('collection_items').delete().eq('collection_id', collectionId).eq('work_id', workId))
    else await run(sb().from('collection_items').insert({ collection_id: collectionId, work_id: workId }))
    emit()
  },

  // ---- 投稿・編集（ZS-WORK-01〜05） ----
  async createDraft(type: WorkType): Promise<Work> {
    const me = requireUser()
    requireCap('canPostWork', '現在、作品の投稿は制限されています')
    // 3.3.7 同じ入力を求めない：前回の使用技術と担当範囲を引き継ぐ
    const last = (await run(sb().from('works').select(WORK_SELECT).eq('owner_id', me.id).order('created_at', { ascending: false }).limit(1))) as Row[]
    const prev = last[0] ? toWork(last[0]) : null
    const row = await run(
      sb()
        .from('works')
        .insert({ owner_id: me.id, type, roles: prev?.roles ?? [] })
        .select('id')
        .single(),
    )
    if (prev?.techIds.length) await rpc('save_work', { p_work: (row as Row).id, p_data: { tech_ids: prev.techIds } })
    const w = await works.get((row as Row).id)
    emit()
    return w!.work
  },

  async update(id: string, patch: Partial<Omit<Work, 'id' | 'ownerId' | 'likeCount' | 'viewCount' | 'status'>>): Promise<Work> {
    requireUser()
    requireCap('canPostWork', '現在、作品の投稿と編集は制限されています')
    if (patch.title !== undefined && patch.title.length > LIMITS.workTitle)
      throw new ApiError('invalid', `タイトルは${LIMITS.workTitle}文字以内で入力してください`)
    if (patch.catchCopy !== undefined && patch.catchCopy.length > LIMITS.catchCopy)
      throw new ApiError('invalid', `キャッチコピーは${LIMITS.catchCopy}文字以内で入力してください`)
    if (patch.description !== undefined && patch.description.length > LIMITS.description)
      throw new ApiError('invalid', `説明は${LIMITS.description.toLocaleString()}文字以内で入力してください`)
    if (patch.media && patch.media.length > LIMITS.galleryImages + 1) throw new ApiError('invalid', '画像は10枚までです')
    // 公開範囲は publish() / setVisibility() だけで変える。自動保存が公開の直後に届いても下書きに戻らないようにする
    const data = workPatch(patch as Partial<Work>)
    if (Object.keys(data).length) await rpc('save_work', { p_work: id, p_data: data })
    const w = await works.get(id)
    if (!w) throw new ApiError('not_found', '作品が見つかりません')
    emit()
    return w.work
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
    requireUser()
    requireCap('canPostWork', '現在、作品の投稿は制限されています')
    const cur = await works.get(id)
    if (!cur) throw new ApiError('not_found', '作品が見つかりません')
    const errs = works.validate(cur.work)
    if (errs.length) throw new ApiError('invalid', `次の項目を入力してください：${errs.join('、')}`)
    await run(sb().from('works').update({ visibility }).eq('id', id))
    const w = await works.get(id)
    emit()
    return w!.work
  },

  async setVisibility(id: string, visibility: Work['visibility']): Promise<void> {
    await run(sb().from('works').update({ visibility }).eq('id', id))
    emit()
  },

  /** 削除した作品は30日間ゴミ箱に残す（ZS-WORK-05） */
  async trash(id: string): Promise<void> {
    await rpc('work_set_trashed', { p_work: id, p_trashed: true })
    emit()
  },

  async restore(id: string): Promise<void> {
    await rpc('work_set_trashed', { p_work: id, p_trashed: false })
    emit()
  },

  async mine(): Promise<Work[]> {
    const me = requireUser()
    const rows = (await run(sb().from('works').select(WORK_SELECT).eq('owner_id', me.id).order('updated_at', { ascending: false }))) as Row[]
    const list = rows.map(toWork)
    putWorks(list)
    return list
  },

  async insights(id: string): Promise<WorkDailyStat[]> {
    requireUser()
    const rows = (await run(sb().from('work_daily_stats').select('*').eq('work_id', id).order('date', { ascending: false }).limit(30))) as Row[]
    return rows.map(toStat).reverse()
  },

  async related(id: string): Promise<{ sameOwner: WorkWithOwner[]; similar: WorkWithOwner[] }> {
    const r = await rpc<Row>('related_works', { p_work: id })
    const [sameOwner, similar] = await Promise.all([hydrate(r.same_owner ?? []), hydrate(r.similar ?? [])])
    return { sameOwner, similar }
  },

  async pickups(): Promise<WorkWithOwner[]> {
    const rows = (await run(sb().from('pickups').select('work_id').order('sort_order'))) as Row[]
    const list = await hydrate(rows.map((r) => r.work_id))
    return list.filter((x) => x.work.status === 'active' && x.work.visibility === 'public')
  },

  /** ZS-HOME-04 興味タグといいね履歴からタグの一致度で選ぶ */
  async recommended(page: { offset: number; limit: number }): Promise<{ items: WorkWithOwner[]; total: number }> {
    const rows = await rpc<{ id: string; total: number }[]>('recommended_works', { p_offset: page.offset, p_limit: page.limit })
    return { items: await hydrate(rows.map((r) => r.id)), total: rows.length ? Number(rows[0].total) : 0 }
  },

  /** ZS-WORK-02 URL から OGP を取得する（Edge Function `og-fetch`。未配置なら URL から仮のタイトルを作る） */
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
    const { data, error } = await sb().invoke<{ title?: string; description?: string; image?: string | null }>('og-fetch', { url })
    if (!error && data && (data.title || data.description)) return { title: data.title ?? '', description: data.description ?? '', image: data.image ?? null }
    return { title: host.replace(/^www\./, ''), description: '', image: null }
  },

  // ---- マスタ ----
  categories(): Master[] {
    return state.categories
  },
  techs(): Master[] {
    return state.techs
  },
  popularTags(): string[] {
    return state.popularTags
  },

  // ---- 検索条件の保存（ZS-WORK-09）・検索履歴（ZS-SRCH-04：端末内） ----
  async savedSearches(): Promise<SavedSearch[]> {
    const me = requireUser()
    const rows = (await run(sb().from('saved_searches').select('*').eq('user_id', me.id).order('created_at'))) as Row[]
    return rows.map(toSavedSearch)
  },
  async saveSearch(name: string, query: WorkQuery, notifyNew: boolean): Promise<SavedSearch> {
    const me = requireUser()
    if (!name.trim()) throw new ApiError('invalid', '名前を入力してください')
    const row = await run(
      sb()
        .from('saved_searches')
        .insert({ user_id: me.id, name: name.trim().slice(0, 30), query: queryJson(query), notify: notifyNew })
        .select('*')
        .single(),
    )
    emit()
    return toSavedSearch(row)
  },
  async updateSavedSearch(id: string, patch: { notify?: boolean; name?: string }): Promise<void> {
    await run(sb().from('saved_searches').update(patch).eq('id', id))
    emit()
  },
  async deleteSavedSearch(id: string): Promise<void> {
    await run(sb().from('saved_searches').delete().eq('id', id))
    emit()
  },
  searchHistory(): string[] {
    return readHistory().slice(0, 10)
  },
  recordSearch(q: string) {
    if (!state.me || !q.trim()) return
    writeHistory([q.trim(), ...readHistory().filter((h) => h !== q.trim())].slice(0, 50))
    emit()
  },
  removeSearchHistory(q: string) {
    writeHistory(readHistory().filter((h) => h !== q))
    emit()
  },
}

function historyKey() {
  return `zenospace:search-history:${state.userId ?? 'guest'}`
}
function readHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(historyKey()) ?? '[]') as string[]
  } catch {
    return []
  }
}
function writeHistory(list: string[]) {
  try {
    localStorage.setItem(historyKey(), JSON.stringify(list))
  } catch {
    /* noop */
  }
}
