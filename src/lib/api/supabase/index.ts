/**
 * データ層の Supabase 実装。画面から見た形（関数名・引数・戻り値）はモック実装と同じ。
 */
import type { mockApi } from '../mock'
import { auth } from './auth'
import { users } from './users'
import { chat } from './chat'
import { works } from './works'
import { notifications, news, banners, reports, app } from './misc'
import { admin } from './adminLazy'
import { storage } from './storage'
import { emit, state, clearUserState } from './store'
import { loadMe, loadPublic, loadRooms, sb } from './core'

let readyPromise: Promise<void> | null = null

/** 起動時の準備：保存されたログイン状態を復元し、設定とマスタを読む（読めなくても画面は開く） */
function ready(): Promise<void> {
  readyPromise ??= (async () => {
    await Promise.all([loadPublic().catch(() => undefined), loadMe().catch(() => undefined)])
    sb().auth.onAuthStateChange((event, session) => {
      // コールバックの中で Supabase を待つと固まるため、次の処理に回す
      setTimeout(() => {
        if (event === 'SIGNED_OUT' || !session) {
          if (state.userId) {
            clearUserState()
            emit()
          }
          return
        }
        if (event === 'SIGNED_IN' && session.user.id !== state.userId) void loadMe().then(emit)
      }, 0)
    })
    // アプリに戻ってきたら、トークリストと未読数を読み直す（裏にいる間は Realtime を切っている端末があるため）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.userId) void loadRooms()
    })
  })()
  return readyPromise
}

export const supabaseApi = { ready, auth, users, chat, works, notifications, news, banners, reports, app, admin, storage }

// 型の一致を確かめる（モックと同じ関数・引数・戻り値であること）
const typed: typeof mockApi = supabaseApi

export const api = typed
export { subscribe } from './store'
export function startBackgroundJobs() {
  // 定期処理はサーバー側（pg_cron と Edge Functions）で行う
}
