import { auth } from './auth'
import { users } from './users'
import { chat } from './chat'
import { works } from './works'
import { notifications, news, banners, reports, app } from './misc'
import { admin } from './admin'
import { storage } from '../storage'

export const mockApi = { auth, users, chat, works, notifications, news, banners, reports, app, admin, storage }
export { startJobs, runJobs } from './jobs'
