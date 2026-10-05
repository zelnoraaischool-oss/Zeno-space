/**
 * データ層の入口。画面はここから `api` を使う。
 *
 * 実装はビルド時に1つ選ぶ（vite.config.ts の `@impl`）：
 *   Supabase の URL と公開鍵があれば Supabase（./supabase/）、なければ端末内のモックDB（./mock/）。
 * どちらも同じ `Api` 型を満たす。
 */
import { api as impl, startBackgroundJobs as startImplJobs, subscribe as subscribeImpl } from '@impl'
import type { mockApi } from './mock'

export type Api = typeof mockApi

export const dataSource = (import.meta.env.VITE_DATA_SOURCE ?? 'mock') as 'mock' | 'supabase'

export const api: Api = impl

export function startBackgroundJobs() {
  startImplJobs()
}

/** データの変更（Realtime を含む）を購読する。useLive / useSync が使う */
export function subscribe(fn: () => void): () => void {
  return subscribeImpl(fn)
}

export { ApiError, errorMessage } from './errors'
export type { SignInResult, PendingIdentity } from './mock/auth'
export type { RoomSummary, RoomDetail, RoomFilter, SendInput } from './mock/chat'
export type { WorkWithOwner, Facets } from './mock/works'
export type { DigestWithItems } from './mock/misc'
export type { Meter, UserState } from './shared'
