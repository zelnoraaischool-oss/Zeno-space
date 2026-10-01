import type { ProductionType, WorkQuery, WorkType } from './types'

/** 絞り込み条件を URL に反映して共有できるようにする（ZS-WORK-07） */
export function queryFromParams(p: URLSearchParams): WorkQuery {
  const list = (k: string) => p.get(k)?.split(',').filter(Boolean)
  const num = (k: string) => (p.get(k) ? Number(p.get(k)) : undefined)
  return {
    q: p.get('q') ?? undefined,
    types: list('type') as WorkType[] | undefined,
    categoryIds: list('cat'),
    techIds: list('tech'),
    tags: list('tag'),
    productionTypes: list('prod') as ProductionType[] | undefined,
    priceMin: num('pmin'),
    priceMax: num('pmax'),
    openOnly: p.get('open') === '1' || undefined,
    sort: (p.get('sort') as WorkQuery['sort']) ?? undefined,
  }
}

export function paramsFromQuery(q: WorkQuery, extra: Record<string, string> = {}): URLSearchParams {
  const p = new URLSearchParams()
  if (q.q) p.set('q', q.q)
  if (q.types?.length) p.set('type', q.types.join(','))
  if (q.categoryIds?.length) p.set('cat', q.categoryIds.join(','))
  if (q.techIds?.length) p.set('tech', q.techIds.join(','))
  if (q.tags?.length) p.set('tag', q.tags.join(','))
  if (q.productionTypes?.length) p.set('prod', q.productionTypes.join(','))
  if (q.priceMin != null) p.set('pmin', String(q.priceMin))
  if (q.priceMax != null) p.set('pmax', String(q.priceMax))
  if (q.openOnly) p.set('open', '1')
  if (q.sort && q.sort !== 'new') p.set('sort', q.sort)
  for (const [k, v] of Object.entries(extra)) p.set(k, v)
  return p
}

export function activeFilterCount(q: WorkQuery): number {
  return (
    (q.types?.length ?? 0) +
    (q.categoryIds?.length ?? 0) +
    (q.techIds?.length ?? 0) +
    (q.tags?.length ?? 0) +
    (q.productionTypes?.length ?? 0) +
    (q.priceMin != null || q.priceMax != null ? 1 : 0) +
    (q.openOnly ? 1 : 0)
  )
}

export const PRICE_STEPS = [0, 30000, 50000, 100000, 200000, 300000, 500000, 1000000]
