import { auth } from './auth'
import { users } from './users'
import { chat } from './chat'
import { works } from './works'
import { notifications, news, banners, reports, app } from './misc'
import { admin } from './admin'
import { storage } from '../storage'
import { startJobs } from './jobs'

/** 起動時の準備（モックは端末内のデータなのですぐ使える） */
const ready = (): Promise<void> => Promise.resolve()

export const mockApi = { ready, auth, users, chat, works, notifications, news, banners, reports, app, admin, storage }
export { startJobs, runJobs } from './jobs'

// データ層の入口（src/lib/api/index.ts）が使う共通の名前
export const api = mockApi
export { subscribe } from '../../mock/db'
export function startBackgroundJobs() {
  startJobs()
}
