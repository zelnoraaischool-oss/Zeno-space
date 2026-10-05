/**
 * Supabase 実装の端末内キャッシュと変更通知。
 *
 * 画面には同期で読む関数（未読数・自分のプロフィール・マスタなど）があるため、
 * サーバーから読んだ値をここに置いて同期で返す。変更（自分の操作・Realtime の受信）があれば emit() で画面に知らせ、
 * useLive / useSync が読み直す。読み込みのたびに emit() すると読み直しが止まらなくなるので、
 * emit() は「操作した」「サーバーから変更が届いた」「同期で求められた値が初めて届いた」ときだけ呼ぶ。
 */
import type { RoomSummary } from '../mock/chat'
import type {
  AdminRole,
  Appeal,
  AppSettings,
  Banner,
  Consent,
  Friendship,
  IdentityKind,
  Master,
  Message,
  NgWord,
  Profile,
  Reaction,
  Restriction,
  RoomMember,
  UserSettings,
  Work,
} from '../../types'

export const DEFAULT_APP_SETTINGS: AppSettings = {
  inviteOnly: false,
  sendRatePerMinute: 30,
  newUserDailyNewTalks: 10,
  groupMaxMembers: 100,
  uploadMaxMb: 10,
  maintenance: { enabled: false, until: null, message: '' },
  reportAutoHideThreshold: 3,
  broadcastDailyLimit: 2,
  broadcastApprovalRequired: true,
  news: {
    time: '07:30',
    days: 'daily',
    mode: 'approval',
    count: 5,
    minCount: 3,
    includeKeywords: [],
    excludeKeywords: [],
    provider: 'workers-ai',
  },
  heavyFeaturesPaused: false,
  termsVersion: '2026-09-30',
  privacyVersion: '2026-09-30',
}

export interface State {
  userId: string | null
  /** メールを確認したが、規約同意と生年月の入力がまだ（登録の途中） */
  pendingEmail: string | null
  me: Profile | null
  settings: UserSettings | null
  restrictions: Restriction[]
  appeals: Appeal[]
  consents: Consent[]
  adminRole: AdminRole | null
  friendships: Friendship[]
  blocks: Set<string>
  likedIds: Set<string>
  dismissedBanners: Set<string>
  unreadNotifications: number
  identities: IdentityKind[]
  rooms: RoomSummary[]
  appSettings: AppSettings
  ngWords: NgWord[]
  categories: Master[]
  techs: Master[]
  popularTags: string[]
  banners: Banner[]
  supportTemplates: { id: string; title: string; body: string }[]
}

export const state: State = {
  userId: null,
  pendingEmail: null,
  me: null,
  settings: null,
  restrictions: [],
  appeals: [],
  consents: [],
  adminRole: null,
  friendships: [],
  blocks: new Set(),
  likedIds: new Set(),
  dismissedBanners: new Set(),
  unreadNotifications: 0,
  identities: [],
  rooms: [],
  appSettings: DEFAULT_APP_SETTINGS,
  ngWords: [],
  categories: [],
  techs: [],
  popularTags: [],
  banners: [],
  supportTemplates: [],
}

/** ログアウト時に本人のデータを消す */
export function clearUserState() {
  Object.assign(state, {
    userId: null,
    pendingEmail: null,
    me: null,
    settings: null,
    restrictions: [],
    appeals: [],
    consents: [],
    adminRole: null,
    friendships: [],
    blocks: new Set(),
    likedIds: new Set(),
    dismissedBanners: new Set(),
    unreadNotifications: 0,
    identities: [],
    rooms: [],
    ngWords: [],
    supportTemplates: [],
  } satisfies Partial<State>)
  messages.clear()
  reactions.clear()
  members.clear()
}

// 個別のキャッシュ（同期で読む関数のため）
export const profiles = new Map<string, Profile>()
export const works = new Map<string, Work>()
export const messages = new Map<number, Message>()
export const reactions = new Map<number, Reaction[]>()
export const members = new Map<string, RoomMember[]>()

// ---- 変更通知 ----
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 画面に変更を知らせる（短い間の連続した変更は1回にまとめる） */
export function emit() {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    for (const l of [...listeners]) l()
  }, 16)
}

export function putProfiles(list: (Profile | null | undefined)[]) {
  for (const p of list) if (p) profiles.set(p.id, p)
}
export function putWorks(list: (Work | null | undefined)[]) {
  for (const w of list) if (w) works.set(w.id, w)
}
export function putMessages(list: Message[]) {
  for (const m of list) messages.set(m.id, m)
}
