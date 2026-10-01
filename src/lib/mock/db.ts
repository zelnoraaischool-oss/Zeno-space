/**
 * モックDB。Supabase 接続前の開発・デモ用に、16章のテーブルを端末内（localStorage）に持つ。
 * 別タブの変更は storage イベントで取り込み、Realtime の代わりにする。
 */
import type {
  AdminMember,
  Appeal,
  AppNotification,
  AppSettings,
  AuditLog,
  Banner,
  Block,
  Broadcast,
  BroadcastEvent,
  Collection,
  Consent,
  DeviceHash,
  DupSuspicion,
  Friendship,
  IdentityKey,
  Inquiry,
  InviteCode,
  Like,
  Master,
  Message,
  NewsDigest,
  NewsItem,
  NewsReaction,
  NewsSource,
  NgWord,
  Profile,
  PushSubscriptionRow,
  Reaction,
  Report,
  Restriction,
  Room,
  RoomInvite,
  RoomMember,
  SavedSearch,
  SupportThread,
  UsageSnapshot,
  UserSettings,
  ViewHistory,
  Work,
  WorkDailyStat,
} from '../types'
import { seed } from './seed'

export interface DB {
  version: number
  profiles: Profile[]
  identityKeys: IdentityKey[]
  bannedIdentities: string[]
  deviceHashes: DeviceHash[]
  consents: Consent[]
  userSettings: UserSettings[]
  friendships: Friendship[]
  blocks: Block[]
  inviteCodes: InviteCode[]
  rooms: Room[]
  roomMembers: RoomMember[]
  messages: Message[]
  messageHides: { userId: string; messageId: number }[]
  reactions: Reaction[]
  roomInvites: RoomInvite[]
  announcements: { roomId: string; messageId: number; pinnedBy: string }[]
  inquiries: Inquiry[]
  works: Work[]
  categories: Master[]
  techs: Master[]
  likes: Like[]
  collections: Collection[]
  viewHistory: ViewHistory[]
  workDailyStats: WorkDailyStat[]
  savedSearches: SavedSearch[]
  searchHistory: { userId: string; q: string; at: string }[]
  pickups: string[]
  notifications: AppNotification[]
  pushSubscriptions: PushSubscriptionRow[]
  broadcasts: Broadcast[]
  broadcastRecipients: { broadcastId: string; userId: string }[]
  broadcastEvents: BroadcastEvent[]
  banners: Banner[]
  dismissedBanners: { userId: string; bannerId: string }[]
  newsSources: NewsSource[]
  newsItems: NewsItem[]
  newsDigests: NewsDigest[]
  newsReactions: NewsReaction[]
  adminMembers: AdminMember[]
  restrictions: Restriction[]
  appeals: Appeal[]
  reports: Report[]
  dupSuspicions: DupSuspicion[]
  supportThreads: SupportThread[]
  supportTemplates: { id: string; title: string; body: string }[]
  ngWords: NgWord[]
  auditLogs: AuditLog[]
  settings: AppSettings
  usageSnapshots: UsageSnapshot[]
  seq: { message: number }
}

const KEY = 'zenospace:mockdb:v1'
const SCHEMA_VERSION = 1

let state: DB | null = null
const listeners = new Set<() => void>()
let saveTimer: ReturnType<typeof setTimeout> | null = null

function load(): DB {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as DB
        if (parsed.version === SCHEMA_VERSION) return parsed
      }
    } catch {
      // 壊れたデータは作り直す
    }
  }
  return seed()
}

export function db(): DB {
  state ??= load()
  return state
}

function persist() {
  if (typeof localStorage === 'undefined' || !state) return
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // 容量超過（画像の data URL など）は端末内メモリだけで続ける
    console.warn('[mock] localStorage への保存に失敗しました（容量超過）')
  }
}

/** 変更を確定し、購読者（画面）へ知らせる。Realtime の postgres_changes に相当 */
export function commit() {
  for (const l of listeners) l()
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(persist, 150)
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function resetDb() {
  state = seed()
  persist()
  commit()
}

if (typeof window !== 'undefined') {
  // 画面を閉じる・再読み込みする直前に、保留中の保存を確定する
  const flush = () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
      persist()
    }
  }
  window.addEventListener('pagehide', flush)
  window.addEventListener('beforeunload', flush)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return
    try {
      state = JSON.parse(e.newValue) as DB
      for (const l of listeners) l()
    } catch {
      /* noop */
    }
  })
}

export function nextMessageId(): number {
  const d = db()
  d.seq.message += 1
  return d.seq.message
}
