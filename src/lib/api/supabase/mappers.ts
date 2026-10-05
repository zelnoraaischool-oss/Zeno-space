/**
 * DB の行（snake_case）を画面用の型（src/lib/types.ts）に変換する。
 * 画像は Storage の公開URLをそのまま保存している（avatar_key / cover_key / storage_key）。
 */
import type {
  AdminMember,
  Appeal,
  AppNotification,
  AppSettings,
  AuditLog,
  Banner,
  Broadcast,
  Collection,
  Consent,
  DupSuspicion,
  Friendship,
  Master,
  Message,
  NewsDigest,
  NewsItem,
  NewsSource,
  NgWord,
  Profile,
  Reaction,
  Report,
  Restriction,
  Room,
  RoomMember,
  SavedSearch,
  SupportThread,
  UserSettings,
  Work,
  WorkDailyStat,
  WorkMedia,
} from '../../types'
import { DEFAULT_APP_SETTINGS } from './store'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>

/** プロフィールで読む列（生年月は本人以外に見せないため列を指定して読む） */
export const PROFILE_COLS =
  'id,handle,display_name,avatar_key,avatar_color,cover_key,bio,skills,links,prefecture,commission_status,dm_policy,profile_visibility,interests,status,is_official,handle_changed_at,onboarded,created_at,last_login_at,deleted_at'

/** 作品と、使用技術・タグ・画像をまとめて読む */
export const WORK_SELECT = '*,work_techs(tech_id),work_tags(tags(name)),work_media(*)'

export function toProfile(r: Row): Profile {
  return {
    id: r.id,
    handle: r.handle,
    displayName: r.display_name,
    avatarUrl: r.avatar_key ?? null,
    avatarColor: r.avatar_color ?? '#3D6B52',
    coverUrl: r.cover_key ?? null,
    bio: r.bio ?? '',
    skills: r.skills ?? [],
    links: r.links ?? [],
    prefecture: r.prefecture ?? null,
    commissionStatus: r.commission_status ?? 'consult',
    dmPolicy: r.dm_policy ?? 'everyone',
    profileVisibility: r.profile_visibility ?? 'public',
    interests: r.interests ?? [],
    status: r.status ?? 'active',
    isOfficial: !!r.is_official,
    birthYm: r.birth_ym ?? null,
    handleChangedAt: r.handle_changed_at ?? null,
    onboarded: !!r.onboarded,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at ?? r.created_at,
    deletedAt: r.deleted_at ?? null,
  }
}

export function profilePatch(p: Partial<Profile>): Row {
  const map: Record<string, string> = {
    displayName: 'display_name',
    avatarUrl: 'avatar_key',
    avatarColor: 'avatar_color',
    coverUrl: 'cover_key',
    bio: 'bio',
    skills: 'skills',
    links: 'links',
    prefecture: 'prefecture',
    commissionStatus: 'commission_status',
    dmPolicy: 'dm_policy',
    profileVisibility: 'profile_visibility',
    interests: 'interests',
    onboarded: 'onboarded',
  }
  const out: Row = {}
  for (const [k, v] of Object.entries(p)) if (map[k] && v !== undefined) out[map[k]] = v
  return out
}

export function toSettings(r: Row): UserSettings {
  return {
    userId: r.user_id,
    notify: r.notify,
    quietHours: r.quiet_hours,
    hidePushBody: !!r.hide_push_body,
    theme: r.theme,
    textSize: r.text_size,
    reduceMotion: !!r.reduce_motion,
    enterToSend: !!r.enter_to_send,
  }
}

export function settingsPatch(p: Partial<UserSettings>): Row {
  const out: Row = {}
  if (p.notify) out.notify = p.notify
  if (p.quietHours) out.quiet_hours = p.quietHours
  if (p.hidePushBody !== undefined) out.hide_push_body = p.hidePushBody
  if (p.theme) out.theme = p.theme
  if (p.textSize) out.text_size = p.textSize
  if (p.reduceMotion !== undefined) out.reduce_motion = p.reduceMotion
  if (p.enterToSend !== undefined) out.enter_to_send = p.enterToSend
  return out
}

export function toRestriction(r: Row): Restriction {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    startsAt: r.starts_at,
    endsAt: r.ends_at ?? null,
    reasonCategory: r.reason_category,
    userMessage: r.user_message ?? '',
    internalNote: r.internal_note ?? '',
    createdBy: r.created_by ?? '',
    liftedAt: r.lifted_at ?? null,
  }
}

export function toAppeal(r: Row): Appeal {
  return {
    id: r.id,
    restrictionId: r.restriction_id,
    userId: r.user_id,
    body: r.body,
    status: r.status,
    decidedBy: r.decided_by ?? null,
    result: r.result ?? null,
    createdAt: r.created_at,
  }
}

export function toConsent(r: Row): Consent {
  return { userId: r.user_id, doc: r.doc, version: r.version, agreedAt: r.agreed_at }
}

export function toFriendship(r: Row): Friendship {
  return { userId: r.user_id, friendId: r.friend_id, hidden: !!r.hidden, createdAt: r.created_at }
}

export function toRoom(r: Row): Room {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name ?? null,
    iconUrl: r.icon_key ?? null,
    iconColor: r.icon_color ?? '#3D6B52',
    ownerId: r.owner_id ?? null,
    workId: r.work_id ?? null,
    lastMessageAt: r.last_message_at,
    lastMessagePreview: r.last_message_preview ?? '',
    memberCount: r.member_count ?? 0,
    createdAt: r.created_at,
  }
}

export function toMember(r: Row): RoomMember {
  return {
    roomId: r.room_id,
    userId: r.user_id,
    role: r.role,
    state: r.state,
    lastReadAt: r.last_read_at,
    notifyLevel: r.notify_level,
    pinnedAt: r.pinned_at ?? null,
    hiddenAt: r.hidden_at ?? null,
    joinedAt: r.joined_at,
  }
}

export function toMessage(r: Row): Message {
  return {
    id: Number(r.id),
    roomId: r.room_id,
    senderId: r.sender_id,
    kind: r.kind,
    body: r.body ?? '',
    replyToId: r.reply_to_id == null ? null : Number(r.reply_to_id),
    meta: r.meta ?? {},
    clientId: r.client_id,
    createdAt: r.created_at,
    unsentAt: r.unsent_at ?? null,
  }
}

export function toReaction(r: Row): Reaction {
  return { messageId: Number(r.message_id), userId: r.user_id, kind: r.kind, createdAt: r.created_at }
}

/** 作品画像：1,200px のURLを保存し、400px は同じキーの接尾辞（_1200 → _400）で求める */
export function thumbOf(url: string): string {
  return url.replace(/_1200\.webp(\?.*)?$/, '_400.webp$1')
}

function toMedia(r: Row): WorkMedia {
  return {
    id: r.id,
    url: r.storage_key,
    thumbUrl: thumbOf(r.storage_key),
    width: r.width,
    height: r.height,
    altText: r.alt_text ?? '',
    dominantColor: r.dominant_color ?? '#D8D6D0',
  }
}

export function toWork(r: Row): Work {
  return {
    id: r.id,
    ownerId: r.owner_id,
    type: r.type,
    title: r.title ?? '',
    catchCopy: r.catch_copy ?? '',
    description: r.description ?? '',
    categoryId: r.category_id ?? null,
    techIds: (r.work_techs ?? []).map((t: Row) => t.tech_id),
    tags: (r.work_tags ?? []).map((t: Row) => t.tags?.name).filter(Boolean),
    productionType: r.production_type ?? null,
    roles: r.roles ?? [],
    periodValue: r.period_value ?? null,
    periodUnit: r.period_unit ?? null,
    priceMin: r.price_min ?? null,
    priceMax: r.price_max ?? null,
    url: r.url ?? '',
    storeUrl: r.store_url ?? '',
    videoUrl: r.video_url ?? '',
    visibility: r.visibility,
    licenseConfirmed: !!r.license_confirmed,
    status: r.status,
    hiddenReason: r.hidden_reason ?? null,
    media: [...(r.work_media ?? [])].sort((a: Row, b: Row) => a.sort_order - b.sort_order).map(toMedia),
    likeCount: r.like_count ?? 0,
    viewCount: r.view_count ?? 0,
    inquiryCount: r.inquiry_count ?? 0,
    publishedAt: r.published_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
    deletedAt: r.deleted_at ?? null,
  }
}

/** 作品の編集内容を save_work() に渡す形にする */
export function workPatch(p: Partial<Work>): Row {
  const out: Row = {}
  const map: Record<string, string> = {
    type: 'type',
    title: 'title',
    catchCopy: 'catch_copy',
    description: 'description',
    categoryId: 'category_id',
    productionType: 'production_type',
    roles: 'roles',
    periodValue: 'period_value',
    periodUnit: 'period_unit',
    priceMin: 'price_min',
    priceMax: 'price_max',
    url: 'url',
    storeUrl: 'store_url',
    videoUrl: 'video_url',
    licenseConfirmed: 'license_confirmed',
    techIds: 'tech_ids',
    tags: 'tags',
  }
  for (const [k, v] of Object.entries(p)) if (map[k] && v !== undefined) out[map[k]] = v
  if (p.media) out.media = p.media
  return out
}

export function toMaster(r: Row): Master {
  return { id: r.id, name: r.name, normalizedName: r.normalized_name, sortOrder: r.sort_order }
}

export function toCollection(r: Row): Collection {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    workIds: (r.collection_items ?? []).map((i: Row) => i.work_id),
    createdAt: r.created_at,
  }
}

export function toSavedSearch(r: Row): SavedSearch {
  return { id: r.id, userId: r.user_id, name: r.name, query: r.query, notify: !!r.notify, lastNotifiedAt: r.last_notified_at ?? null, createdAt: r.created_at }
}

export function toStat(r: Row): WorkDailyStat {
  return { workId: r.work_id, date: r.date, views: r.views, likes: r.likes, inquiries: r.inquiries }
}

export function toNotification(r: Row): AppNotification {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    actorId: r.actor_id ?? null,
    target: r.target,
    text: r.text,
    groupedCount: r.grouped_count ?? 1,
    readAt: r.read_at ?? null,
    createdAt: r.created_at,
  }
}

export function toBanner(r: Row): Banner {
  return { id: r.id, title: r.title, body: r.body ?? '', link: r.link ?? null, startsAt: r.starts_at, endsAt: r.ends_at, target: r.target }
}

export function bannerRow(b: Partial<Banner>): Row {
  return { title: b.title, body: b.body ?? '', link: b.link || null, starts_at: b.startsAt, ends_at: b.endsAt, target: b.target ?? 'home' }
}

export function toSource(r: Row): NewsSource {
  return {
    id: r.id,
    name: r.name,
    feedUrl: r.feed_url,
    lang: r.lang,
    weight: Number(r.weight),
    enabled: !!r.enabled,
    lastSuccessAt: r.last_success_at ?? null,
    failureCount: r.failure_count ?? 0,
    termsCheckedAt: r.terms_checked_at ?? null,
  }
}

export function toNewsItem(r: Row): NewsItem {
  return {
    id: r.id,
    sourceId: r.source_id,
    url: r.url,
    title: r.title,
    titleJa: r.title_ja ?? '',
    summaryJa: r.summary_ja ?? null,
    category: r.category,
    publishedAt: r.published_at,
    score: Number(r.score ?? 0),
    scoreDetail: { weight: 0, keyword: 0, freshness: 0, ...(r.score_detail ?? {}) },
    digestId: r.digest_id ?? null,
    rank: r.rank ?? null,
  }
}

export function toDigest(r: Row): NewsDigest {
  return {
    id: r.id,
    date: r.date,
    status: r.status,
    stage: r.stage,
    failedStage: r.failed_stage ?? null,
    approvedBy: r.approved_by ?? null,
    sentAt: r.sent_at ?? null,
    broadcastId: r.broadcast_id ?? null,
  }
}

export function toBroadcast(r: Row): Broadcast {
  return {
    id: r.id,
    title: r.title ?? '',
    status: r.canceled_at && r.status !== 'sent' ? 'canceled' : r.status,
    audience: r.audience,
    segmentQuery: r.segment_query ?? null,
    bubbles: r.bubbles ?? [],
    pushText: r.push_text ?? '',
    scheduledAt: r.scheduled_at ?? null,
    sentAt: r.sent_at ?? null,
    canceledAt: r.canceled_at ?? null,
    targetCount: r.target_count ?? 0,
    pushDelivered: r.push_delivered ?? 0,
    createdBy: r.created_by ?? '',
    approvedBy: r.approved_by ?? null,
    createdAt: r.created_at,
    kind: r.kind ?? 'broadcast',
  }
}

export function broadcastRow(b: Partial<Broadcast>): Row {
  const out: Row = {}
  if (b.title !== undefined) out.title = b.title
  if (b.audience !== undefined) out.audience = b.audience
  if (b.segmentQuery !== undefined) out.segment_query = b.segmentQuery
  if (b.bubbles !== undefined) out.bubbles = b.bubbles
  if (b.pushText !== undefined) out.push_text = b.pushText
  if (b.scheduledAt !== undefined) out.scheduled_at = b.scheduledAt
  if (b.kind !== undefined) out.kind = b.kind
  return out
}

export function toReport(r: Row): Report {
  return {
    id: r.id,
    reporterId: r.reporter_id,
    targetType: r.target_type,
    targetId: r.target_id,
    reason: r.reason,
    detail: r.detail ?? '',
    sharedMessages: r.shared_messages ? (r.shared_messages as Row[]).map(toMessage) : null,
    status: r.status,
    assigneeId: r.assignee_id ?? null,
    createdAt: r.created_at,
    firstActionAt: r.first_action_at ?? null,
    resolvedAt: r.resolved_at ?? null,
  }
}

export function toDup(r: Row): DupSuspicion {
  return {
    id: r.id,
    deviceHash: r.device_hash,
    userIds: r.user_ids ?? [],
    status: r.status,
    decision: r.decision ?? null,
    decidedBy: r.decided_by ?? null,
    createdAt: r.created_at,
  }
}

export function toSupportThread(r: Row): SupportThread {
  return { roomId: r.room_id, userId: r.user_id, assigneeId: r.assignee_id ?? null, status: r.status, lastUserMessageAt: r.last_user_message_at }
}

export function toNgWord(r: Row): NgWord {
  return { id: r.id, word: r.word, severity: r.severity }
}

export function toAdminMember(r: Row): AdminMember {
  return { userId: r.user_id, role: r.role, totpEnrolled: !!r.totp_enrolled }
}

export function toAuditLog(r: Row): AuditLog {
  return {
    id: String(r.id),
    actorId: r.actor_id ?? '',
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    before: r.before,
    after: r.after,
    createdAt: r.created_at,
  }
}

/** app_settings（キーと JSON 値の行）と画面用の設定の対応 */
const SETTING_KEYS: Record<string, keyof AppSettings> = {
  invite_only: 'inviteOnly',
  send_rate_per_minute: 'sendRatePerMinute',
  new_user_daily_new_talks: 'newUserDailyNewTalks',
  group_max_members: 'groupMaxMembers',
  upload_max_mb: 'uploadMaxMb',
  maintenance: 'maintenance',
  report_auto_hide_threshold: 'reportAutoHideThreshold',
  broadcast_daily_limit: 'broadcastDailyLimit',
  broadcast_approval_required: 'broadcastApprovalRequired',
  heavy_features_paused: 'heavyFeaturesPaused',
  terms_version: 'termsVersion',
  privacy_version: 'privacyVersion',
  news: 'news',
}

export function toAppSettings(rows: Row[], base: AppSettings = DEFAULT_APP_SETTINGS): AppSettings {
  const out = structuredClone(base) as unknown as Record<string, unknown>
  for (const r of rows) {
    const k = SETTING_KEYS[r.key]
    if (!k) continue
    out[k] = k === 'news' ? { ...base.news, ...(r.value ?? {}) } : r.value
  }
  return out as unknown as AppSettings
}

export function appSettingsRows(patch: Partial<AppSettings>): Row {
  const inv = Object.fromEntries(Object.entries(SETTING_KEYS).map(([a, b]) => [b, a]))
  const out: Row = {}
  for (const [k, v] of Object.entries(patch)) if (inv[k]) out[inv[k]] = v
  return out
}
