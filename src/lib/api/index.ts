/**
 * データ層の入口。画面はここから `api` を使う。
 *
 * VITE_DATA_SOURCE=mock     … 端末内のモックDB（Supabase 接続前の既定）
 * VITE_DATA_SOURCE=supabase … Supabase（./supabase/ の実装に差し替える。docs/supabase-setup.md 参照）
 *
 * どちらも同じ `Api` 型を満たす。
 */
import { mockApi, startJobs } from './mock'

export type Api = typeof mockApi

export const dataSource = (import.meta.env.VITE_DATA_SOURCE ?? 'mock') as 'mock' | 'supabase'

export const api: Api = mockApi

export function startBackgroundJobs() {
  if (dataSource === 'mock') startJobs()
}

export { subscribe } from '../mock/db'
export { ApiError, errorMessage } from './errors'
export type { SignInResult, PendingIdentity } from './mock/auth'
export type { RoomSummary, RoomDetail, RoomFilter } from './mock/chat'
export type { WorkWithOwner, Facets } from './mock/works'
export type { DigestWithItems } from './mock/misc'
export type { Meter, UserState } from './mock/admin'
