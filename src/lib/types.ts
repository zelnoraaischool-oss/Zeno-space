/**
 * ドメイン型。16章のテーブル定義に対応する（列名は camelCase に変換）。
 * Supabase 接続後は `supabase gen types` の生成型からこの型へ変換する。
 */

export type ID = string
export type ISODate = string

export type CommissionStatus = 'open' | 'consult' | 'closed'
export type DmPolicy = 'everyone' | 'friends' | 'inquiry'
export type AccountStatus = 'active' | 'frozen' | 'banned' | 'leaving'
export type ProfileVisibility = 'public' | 'members'

export interface Profile {
  id: ID
  handle: string
  displayName: string
  avatarUrl: string | null
  avatarColor: string
  coverUrl: string | null
  bio: string
  skills: string[]
  links: string[]
  prefecture: string | null
  commissionStatus: CommissionStatus
  dmPolicy: DmPolicy
  profileVisibility: ProfileVisibility
  interests: string[]
  status: AccountStatus
  isOfficial: boolean
  birthYm: string | null
  handleChangedAt: ISODate | null
  onboarded: boolean
  createdAt: ISODate
  lastLoginAt: ISODate
  deletedAt: ISODate | null
}

export type IdentityKind = 'email' | 'google' | 'github'
export interface IdentityKey {
  userId: ID
  kind: IdentityKind
  value: string // 本番はハッシュ値（value_hash）
}

export interface DeviceHash {
  userId: ID
  deviceHash: string
  firstSeenAt: ISODate
  lastSeenAt: ISODate
}

export interface Consent {
  userId: ID
  doc: 'terms' | 'privacy'
  version: string
  agreedAt: ISODate
}

export type NotificationKind = 'message' | 'mention' | 'request' | 'friend' | 'like' | 'inquiry' | 'saved_search' | 'broadcast' | 'news' | 'important'

export interface UserSettings {
  userId: ID
  notify: Record<NotificationKind, boolean>
  quietHours: { enabled: boolean; start: string; end: string }
  hidePushBody: boolean
  theme: 'system' | 'light' | 'dark'
  textSize: 'normal' | 'large' | 'xlarge'
  reduceMotion: boolean
  enterToSend: boolean
}

export interface Friendship {
  userId: ID
  friendId: ID
  hidden: boolean
  createdAt: ISODate
}

export interface Block {
  blockerId: ID
  blockedId: ID
  createdAt: ISODate
}

export interface InviteCode {
  code: string
  issuedBy: ID
  usedBy: ID | null
  usedAt: ISODate | null
  expiresAt: ISODate | null
}

// ---- チャット ----
export type RoomKind = 'direct' | 'group' | 'inquiry' | 'official'
export interface Room {
  id: ID
  kind: RoomKind
  name: string | null
  iconUrl: string | null
  iconColor: string
  ownerId: ID | null
  workId: ID | null
  lastMessageAt: ISODate
  lastMessagePreview: string
  memberCount: number
  createdAt: ISODate
}

export type MemberRole = 'owner' | 'admin' | 'member'
export type MemberState = 'active' | 'request' | 'left'
export type NotifyLevel = 'all' | 'mention' | 'off'
export interface RoomMember {
  roomId: ID
  userId: ID
  role: MemberRole
  state: MemberState
  lastReadAt: ISODate
  notifyLevel: NotifyLevel
  pinnedAt: ISODate | null
  hiddenAt: ISODate | null
  joinedAt: ISODate
}

export type MessageKind = 'text' | 'image' | 'file' | 'work' | 'link' | 'system' | 'rich'

export interface RichCard {
  imageUrl?: string
  title: string
  body?: string
  buttons?: { key: string; label: string; url: string }[]
}
export type Bubble =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'card'; card: RichCard }
  | { type: 'carousel'; cards: RichCard[] }
  | { type: 'work'; workId: ID }

export interface MessageMeta {
  images?: { url: string; thumbUrl: string; width: number; height: number; alt?: string }[]
  workId?: ID
  bubble?: Bubble
  broadcastId?: ID
  newsDigestId?: ID
  mentions?: ID[]
  fromAdmin?: { name?: string }
}

export interface Message {
  id: number
  roomId: ID
  senderId: ID
  kind: MessageKind
  body: string
  replyToId: number | null
  meta: MessageMeta
  clientId: string
  createdAt: ISODate
  unsentAt: ISODate | null
}

export type ReactionKind = 'like' | 'heart' | 'laugh' | 'wow' | 'sad' | 'thanks'
export interface Reaction {
  messageId: number
  userId: ID
  kind: ReactionKind
  createdAt: ISODate
}

export interface RoomInvite {
  roomId: ID
  token: string
  expiresAt: ISODate | null
  requiresApproval: boolean
}

export interface Inquiry {
  id: ID
  roomId: ID
  workId: ID
  fromUser: ID
  toUser: ID
  template: string | null
  createdAt: ISODate
  firstReplyAt: ISODate | null
}

// ---- ショーケース ----
export type WorkType = 'hp' | 'lp' | 'app' | 'image' | 'video' | 'other'
export type ProductionType = 'client' | 'personal' | 'study'
export type WorkVisibility = 'public' | 'unlisted' | 'draft'
export type WorkStatus = 'active' | 'hidden' | 'trashed'

export interface WorkMedia {
  id: ID
  url: string // 1,200px
  thumbUrl: string // 400px
  width: number
  height: number
  altText: string
  dominantColor: string
}

export interface Work {
  id: ID
  ownerId: ID
  type: WorkType
  title: string
  catchCopy: string
  description: string
  categoryId: ID | null
  techIds: ID[]
  tags: string[]
  productionType: ProductionType | null
  roles: string[]
  periodValue: number | null
  periodUnit: 'day' | 'week' | 'month' | null
  priceMin: number | null
  priceMax: number | null
  url: string
  storeUrl: string
  videoUrl: string
  visibility: WorkVisibility
  licenseConfirmed: boolean
  status: WorkStatus
  hiddenReason: string | null
  media: WorkMedia[]
  likeCount: number
  viewCount: number
  inquiryCount: number
  publishedAt: ISODate | null
  createdAt: ISODate
  updatedAt: ISODate
  deletedAt: ISODate | null
}

export interface Master {
  id: ID
  name: string
  normalizedName: string
  sortOrder: number
}

export interface Like {
  userId: ID
  workId: ID
  createdAt: ISODate
}

export interface Collection {
  id: ID
  userId: ID
  name: string
  workIds: ID[]
  createdAt: ISODate
}

export interface ViewHistory {
  userId: ID
  workId: ID
  viewedAt: ISODate
}

export interface WorkDailyStat {
  workId: ID
  date: string
  views: number
  likes: number
  inquiries: number
}

export interface WorkQuery {
  q?: string
  types?: WorkType[]
  categoryIds?: ID[]
  techIds?: ID[]
  tags?: string[]
  productionTypes?: ProductionType[]
  priceMin?: number
  priceMax?: number
  openOnly?: boolean
  ownerId?: ID
  sort?: 'new' | 'popular' | 'likes' | 'views'
}

export interface SavedSearch {
  id: ID
  userId: ID
  name: string
  query: WorkQuery
  notify: boolean
  lastNotifiedAt: ISODate | null
  createdAt: ISODate
}

// ---- 通知・配信・AIニュース ----
export interface AppNotification {
  id: ID
  userId: ID
  kind: NotificationKind
  actorId: ID | null
  target: string // 遷移先パス
  text: string
  groupedCount: number
  readAt: ISODate | null
  createdAt: ISODate
}

export interface PushSubscriptionRow {
  userId: ID
  endpoint: string
  keys: { p256dh: string; auth: string }
  userAgent: string
  failureCount: number
}

export type BroadcastStatus = 'draft' | 'pending' | 'scheduled' | 'sent' | 'canceled'
export interface SegmentQuery {
  registeredAfter?: string
  registeredBefore?: string
  lastLoginWithinDays?: number
  hasWorks?: boolean
  interests?: string[]
  commissionStatus?: CommissionStatus[]
  testUsersOnly?: boolean
}
export interface Broadcast {
  id: ID
  title: string
  status: BroadcastStatus
  audience: 'all' | 'segment' | 'test'
  segmentQuery: SegmentQuery | null
  bubbles: Bubble[]
  pushText: string
  scheduledAt: ISODate | null
  sentAt: ISODate | null
  canceledAt: ISODate | null
  targetCount: number
  pushDelivered: number
  createdBy: ID
  approvedBy: ID | null
  createdAt: ISODate
  kind: 'broadcast' | 'news' | 'important'
}

export interface BroadcastEvent {
  broadcastId: ID
  userId: ID
  kind: 'read' | 'click'
  buttonKey: string | null
  createdAt: ISODate
}

export interface Banner {
  id: ID
  title: string
  body: string
  link: string | null
  startsAt: ISODate
  endsAt: ISODate
  target: 'all' | 'home'
}

export interface NewsSource {
  id: ID
  name: string
  feedUrl: string
  lang: 'ja' | 'en'
  weight: number
  enabled: boolean
  lastSuccessAt: ISODate | null
  failureCount: number
  termsCheckedAt: ISODate | null
}

export type NewsCategory = 'model' | 'product' | 'research' | 'policy' | 'business'
export interface NewsItem {
  id: ID
  sourceId: ID
  url: string
  title: string
  titleJa: string
  summaryJa: string | null
  category: NewsCategory
  publishedAt: ISODate
  score: number
  scoreDetail: { weight: number; keyword: number; freshness: number }
  digestId: ID | null
  rank: number | null
}

export type DigestStatus = 'collecting' | 'pending' | 'approved' | 'sent' | 'skipped' | 'failed'
export interface NewsDigest {
  id: ID
  date: string
  status: DigestStatus
  stage: 'collect' | 'dedupe' | 'select' | 'summarize' | 'review' | 'sent'
  failedStage: string | null
  approvedBy: ID | null
  sentAt: ISODate | null
  broadcastId: ID | null
}

export interface NewsReaction {
  itemId: ID
  userId: ID
  kind: 'useful' | 'bookmark'
}

// ---- 運営 ----
export type AdminRole = 'owner' | 'admin' | 'moderator' | 'publisher' | 'viewer'
export interface AdminMember {
  userId: ID
  role: AdminRole
  totpEnrolled: boolean
}

export type RestrictionKind = 'warning' | 'chat_send' | 'new_talk' | 'chat_all' | 'post' | 'freeze' | 'ban'
export interface Restriction {
  id: ID
  userId: ID
  kind: RestrictionKind
  startsAt: ISODate
  endsAt: ISODate | null
  reasonCategory: string
  userMessage: string
  internalNote: string
  createdBy: ID
  liftedAt: ISODate | null
}

export interface Appeal {
  id: ID
  restrictionId: ID
  userId: ID
  body: string
  status: 'open' | 'reviewing' | 'lifted' | 'kept'
  decidedBy: ID | null
  result: string | null
  createdAt: ISODate
}

export type ReportTarget = 'work' | 'user' | 'message'
export type ReportStatus = 'open' | 'in_progress' | 'resolved' | 'rejected'
export interface Report {
  id: ID
  reporterId: ID
  targetType: ReportTarget
  targetId: ID
  reason: string
  detail: string
  sharedMessages: Message[] | null
  status: ReportStatus
  assigneeId: ID | null
  createdAt: ISODate
  firstActionAt: ISODate | null
  resolvedAt: ISODate | null
}

export interface DupSuspicion {
  id: ID
  deviceHash: string
  userIds: ID[]
  status: 'open' | 'ok' | 'confirm' | 'suspended'
  decision: string | null
  decidedBy: ID | null
  createdAt: ISODate
}

export interface SupportThread {
  roomId: ID
  userId: ID
  assigneeId: ID | null
  status: 'open' | 'pending' | 'closed'
  lastUserMessageAt: ISODate
}

export interface NgWord {
  id: ID
  word: string
  severity: 'warn' | 'block'
}

export interface AuditLog {
  id: ID
  actorId: ID
  action: string
  targetType: string
  targetId: string
  before: unknown
  after: unknown
  createdAt: ISODate
}

export interface AppSettings {
  inviteOnly: boolean
  sendRatePerMinute: number
  newUserDailyNewTalks: number
  groupMaxMembers: number
  uploadMaxMb: number
  maintenance: { enabled: boolean; until: ISODate | null; message: string }
  reportAutoHideThreshold: number
  broadcastDailyLimit: number
  broadcastApprovalRequired: boolean
  news: {
    time: string
    days: 'daily' | 'weekdays'
    mode: 'auto' | 'approval'
    count: number
    minCount: number
    includeKeywords: string[]
    excludeKeywords: string[]
    provider: 'workers-ai' | 'gemini'
  }
  heavyFeaturesPaused: boolean
  termsVersion: string
  privacyVersion: string
}

export interface UsageSnapshot {
  date: string
  metric: UsageMetric
  value: number
}
export type UsageMetric =
  'db_bytes' | 'storage_bytes' | 'realtime_peak' | 'realtime_messages' | 'egress_bytes' | 'function_invocations' | 'worker_requests' | 'r2_bytes'
