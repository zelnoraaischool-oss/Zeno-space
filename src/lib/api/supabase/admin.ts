/**
 * 10章 運営コンソール（Supabase）。
 * 運営の権限は TOTP 済み（aal2）のセッションでだけ有効になり、RLS と運営用 RPC が強制する。操作は監査ログに残る。
 */
import { ApiError } from '../errors'
import { toMeters, type Meter, type UserState } from '../shared'
import type {
  AdminRole,
  AppSettings,
  Appeal,
  AuditLog,
  Banner,
  Broadcast,
  Bubble,
  DupSuspicion,
  NewsSource,
  Profile,
  Report,
  ReportStatus,
  Restriction,
  RestrictionKind,
  SegmentQuery,
  UsageMetric,
  Work,
} from '../../types'
import { LIMITS, OFFICIAL_USER_ID } from '../../constants'
import { matchesSearch, normalizeSearch } from '../../normalize'
import { jstDateKey, formatDateTime } from '../../format'
import { emit, profiles, putProfiles, state } from './store'
import { loadPublic, rpc, run, sb } from './core'
import {
  appSettingsRows,
  bannerRow,
  broadcastRow,
  toAdminMember,
  toAppeal,
  toAuditLog,
  toBanner,
  toBroadcast,
  toDigest,
  toDup,
  toMessage,
  toNewsItem,
  toProfile,
  toReport,
  toRestriction,
  toSource,
  toSupportThread,
  toWork,
  WORK_SELECT,
} from './mappers'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>

async function adminProfiles(ids: string[]): Promise<Map<string, Profile>> {
  const need = [...new Set(ids.filter((id) => id && !profiles.has(id)))]
  if (need.length) {
    const rows = await rpc<Row[]>('admin_profiles', { p_ids: need })
    putProfiles(rows.map(toProfile))
  }
  return new Map(ids.map((id) => [id, profiles.get(id)!]).filter(([, p]) => !!p) as [string, Profile][])
}

function validateBroadcast(b: Partial<Broadcast>) {
  const bubbles = (b.bubbles ?? []) as Bubble[]
  if (!bubbles.length) throw new ApiError('invalid', '吹き出しを1つ以上追加してください')
  for (const bubble of bubbles) {
    if (bubble.type === 'text' && !bubble.text.trim()) throw new ApiError('invalid', '空のテキスト吹き出しがあります')
    if (bubble.type === 'carousel' && bubble.cards.length > 10) throw new ApiError('invalid', 'カルーセルのカードは10枚までです')
    const cards = bubble.type === 'card' ? [bubble.card] : bubble.type === 'carousel' ? bubble.cards : []
    for (const c of cards) if ((c.buttons?.length ?? 0) > 3) throw new ApiError('invalid', 'カードのボタンは3つまでです')
  }
}

async function loadTemplates() {
  const rows = (await run(sb().from('support_templates').select('id,title,body').order('created_at'))) as Row[]
  state.supportTemplates = rows.map((r) => ({ id: r.id, title: r.title, body: r.body }))
}
let templatesRequested = false

export const admin = {
  // ---------- ダッシュボード（A-02 / ZS-ADM-23） ----------
  async dashboard() {
    const d = await rpc<Row>('admin_dashboard')
    return {
      dau: Number(d.dau),
      wau: Number(d.wau),
      mau: Number(d.mau),
      totalUsers: Number(d.total_users),
      newUsers: (d.new_users ?? []).map(Number) as number[],
      messages: (d.messages ?? []).map(Number) as number[],
      newWorks: (d.new_works ?? []).map(Number) as number[],
      inquiries: (d.inquiries ?? []).map(Number) as number[],
      registrations30: (d.registrations30 ?? []).map(Number) as number[],
      active30: (d.active30 ?? []).map(Number) as number[],
      openReports: Number(d.open_reports),
      overdueReports: Number(d.overdue_reports),
      pendingBroadcasts: Number(d.pending_broadcasts),
      scheduledBroadcasts: (d.scheduled_broadcasts ?? []).map(toBroadcast) as Broadcast[],
      newsToday: d.news_today ? toDigest(d.news_today) : null,
      dupOpen: Number(d.dup_open),
      appealsOpen: Number(d.appeals_open),
      failingSources: (d.failing_sources ?? []).map(toSource) as NewsSource[],
      kpi: { postRate: Number(d.post_rate ?? 0), chatActivity: Number(d.chat_activity ?? 0) },
    }
  },

  /** ZS-ADM-24 無料枠モニター（70%で注意、90%で警告） */
  async usage(): Promise<Meter[]> {
    const rows = await rpc<Row[]>('admin_usage')
    return toMeters(rows.map((r) => ({ date: r.date, metric: r.metric, value: Number(r.value) })))
  },

  /** 確認用：使用量を書き換えて逼迫時の動き（重い機能の一時停止）を確かめる */
  async simulateUsage(metric: UsageMetric, pct: number): Promise<void> {
    const { USAGE_LIMITS } = await import('../shared')
    const value = Math.round(USAGE_LIMITS[metric].limit * pct)
    await rpc('admin_simulate_usage', { p_metric: metric, p_value: value, p_paused: pct >= 0.9 })
    await loadPublic()
    emit()
  },

  // ---------- ユーザー（A-03 / A-04） ----------
  async searchUsers(q: string, st?: UserState | 'all'): Promise<{ profile: Profile; state: UserState; email: string }[]> {
    const rows = await rpc<Row[]>('admin_search_users', { p_q: q ?? '', p_state: st ?? 'all' })
    const list = rows.map((r) => ({ profile: toProfile(r.profile), state: r.state as UserState, email: r.email ?? '' }))
    putProfiles(list.map((x) => x.profile))
    return list
  },

  async userDetail(id: string) {
    const d = await rpc<Row>('admin_user_detail', { p_user: id })
    const sameDevice = (d.same_device ?? []).map(toProfile) as Profile[]
    putProfiles([toProfile(d.profile), ...sameDevice])
    return {
      profile: toProfile(d.profile),
      state: d.state as UserState,
      identities: (d.identities ?? []) as { kind: 'email' | 'google' | 'github'; value: string }[],
      works: (d.works ?? []).map(toWork) as Work[],
      stats: {
        messagesSent: Number(d.stats?.messages_sent ?? 0),
        likesGiven: Number(d.stats?.likes_given ?? 0),
        likesReceived: Number(d.stats?.likes_received ?? 0),
        friends: Number(d.stats?.friends ?? 0),
      },
      restrictions: (d.restrictions ?? []).map(toRestriction) as Restriction[],
      reportsAbout: (d.reports_about ?? []).map(toReport) as Report[],
      reportsBy: Number(d.reports_by ?? 0),
      appeals: (d.appeals ?? []).map(toAppeal) as Appeal[],
      devices: (d.devices ?? []).map((x: Row) => ({ userId: x.user_id, deviceHash: x.device_hash, firstSeenAt: x.first_seen_at, lastSeenAt: x.last_seen_at })),
      sameDevice,
      adminRole: (d.admin_role ?? null) as AdminRole | null,
    }
  },

  /** ZS-ADM-01/05/06 利用制限の実行（一括可）。公式アカウントから本人に知らせる */
  async restrict(input: {
    userIds: string[]
    kind: RestrictionKind
    durationMs: number | null
    until?: string | null
    reasonCategory: string
    userMessage: string
    internalNote: string
  }): Promise<string[]> {
    if (!input.reasonCategory) throw new ApiError('invalid', '理由カテゴリを選んでください')
    const endsAt = input.until ? new Date(input.until).toISOString() : input.durationMs ? new Date(Date.now() + input.durationMs).toISOString() : null
    const ids = await rpc<string[]>('admin_restrict', {
      p_users: input.userIds.filter((id) => id !== OFFICIAL_USER_ID),
      p_kind: input.kind,
      p_ends_at: endsAt,
      p_reason: input.reasonCategory,
      p_user_message: input.userMessage,
      p_internal_note: input.internalNote,
    })
    emit()
    return ids
  },

  /** 実行直後の「元に戻す」（15秒以内・永久停止は対象外） */
  async undoRestrictions(ids: string[]): Promise<void> {
    await rpc('admin_undo_restrictions', { p_ids: ids })
    emit()
  },

  async liftRestriction(id: string, note: string): Promise<void> {
    await rpc('admin_lift_restriction', { p_restriction: id, p_note: note })
    emit()
  },

  // ---------- 異議申し立て（ZS-ADM-07） ----------
  async appeals() {
    const rows = (await run(sb().from('appeals').select('*').order('created_at', { ascending: false }))) as Row[]
    const list = rows.map(toAppeal)
    const restrictions = list.length
      ? (
          (await run(
            sb()
              .from('restrictions')
              .select('*')
              .in('id', [...new Set(list.map((a) => a.restrictionId))]),
          )) as Row[]
        ).map(toRestriction)
      : []
    const pm = await adminProfiles(list.map((a) => a.userId))
    return list
      .map((appeal) => ({ appeal, user: pm.get(appeal.userId)!, restriction: restrictions.find((r) => r.id === appeal.restrictionId) }))
      .filter((x) => x.user)
  },
  async decideAppeal(id: string, decision: 'reviewing' | 'lifted' | 'kept', result: string): Promise<void> {
    await rpc('admin_decide_appeal', { p_id: id, p_decision: decision, p_result: result })
    emit()
  },

  // ---------- 重複の疑い（ZS-ONE-04 / ZS-ADM-12） ----------
  async dupSuspicions(): Promise<(DupSuspicion & { users: Profile[] })[]> {
    const rows = (await run(sb().from('dup_suspicions').select('*').order('created_at', { ascending: false }))) as Row[]
    const list = rows.map(toDup)
    const pm = await adminProfiles(list.flatMap((s) => s.userIds))
    return list.map((s) => ({ ...s, users: s.userIds.map((id) => pm.get(id)!).filter(Boolean) }))
  },
  async decideDup(id: string, status: 'ok' | 'confirm' | 'suspended', decision: string): Promise<void> {
    await rpc('admin_decide_dup', { p_id: id, p_status: status, p_decision: decision })
    emit()
  },

  // ---------- 通報（A-05 / ZS-ADM-13〜16） ----------
  async reports(status: ReportStatus | 'all' = 'all') {
    let q = sb().from('reports').select('*').order('created_at', { ascending: false }).limit(300)
    if (status !== 'all') q = q.eq('status', status)
    const list = ((await run(q)) as Row[]).map(toReport)
    const workIds = list.filter((r) => r.targetType === 'work').map((r) => r.targetId)
    const msgIds = list.filter((r) => r.targetType === 'message').map((r) => Number(r.targetId))
    const [worksRows, msgRows] = await Promise.all([
      workIds.length ? run(sb().from('works').select('id,title,owner_id').in('id', workIds)) : Promise.resolve([]),
      msgIds.length ? run(sb().from('messages').select('id,sender_id').in('id', msgIds)) : Promise.resolve([]),
    ])
    const wmap = new Map((worksRows as Row[]).map((w) => [w.id, w]))
    const mmap = new Map((msgRows as Row[]).map((m) => [String(m.id), m]))
    const userIds = list.flatMap((r) => [r.reporterId, r.targetType === 'user' ? r.targetId : '', r.assigneeId ?? ''])
    for (const r of list) for (const m of r.sharedMessages ?? []) userIds.push(m.senderId)
    const pm = await adminProfiles(userIds.filter(Boolean))
    const counts = new Map<string, number>()
    for (const r of list) counts.set(r.targetId, (counts.get(r.targetId) ?? 0) + 1)
    return list.map((report) => {
      let target: { label: string; link: string | null; ownerId: string | null }
      if (report.targetType === 'user') {
        const p = pm.get(report.targetId)
        target = { label: p ? `${p.displayName}（@${p.handle}）` : '退会したユーザー', link: p ? `/admin/users/${p.id}` : null, ownerId: p?.id ?? null }
      } else if (report.targetType === 'work') {
        const w = wmap.get(report.targetId)
        target = { label: w ? `作品「${w.title}」` : '削除された作品', link: w ? `/works/${w.id}` : null, ownerId: w?.owner_id ?? null }
      } else {
        target = { label: 'メッセージ', link: null, ownerId: mmap.get(report.targetId)?.sender_id ?? null }
      }
      return { report, reporter: pm.get(report.reporterId), target, pastCount: (counts.get(report.targetId) ?? 1) - 1 }
    })
  },
  async updateReport(id: string, patch: { status?: ReportStatus; assigneeId?: string | null }): Promise<void> {
    const cur = (await run(sb().from('reports').select('status').eq('id', id).single())) as Row
    await rpc('admin_update_report', { p_id: id, p_status: patch.status ?? cur.status, p_assignee: patch.assigneeId ?? null })
    emit()
  },

  // ---------- 作品（A-06 / ZS-ADM-17） ----------
  async works(q: string, filter: 'all' | 'hidden' | 'pickup' = 'all'): Promise<{ work: Work; owner: Profile; pickup: boolean; reports: number }[]> {
    let query = sb()
      .from('works')
      .select(WORK_SELECT)
      .neq('visibility', 'draft')
      .neq('status', 'trashed')
      .order('published_at', { ascending: false })
      .limit(300)
    if (filter === 'hidden') query = query.eq('status', 'hidden')
    const [rows, picks, reps] = await Promise.all([
      run(query),
      run(sb().from('pickups').select('work_id')),
      run(sb().from('reports').select('target_id').eq('target_type', 'work')),
    ])
    const pickSet = new Set((picks as Row[]).map((p) => p.work_id))
    const repCount = new Map<string, number>()
    for (const r of reps as Row[]) repCount.set(r.target_id, (repCount.get(r.target_id) ?? 0) + 1)
    let list = (rows as Row[]).map(toWork)
    if (filter === 'pickup') list = list.filter((w) => pickSet.has(w.id))
    const pm = await adminProfiles(list.map((w) => w.ownerId))
    return list
      .map((work) => ({ work, owner: pm.get(work.ownerId)!, pickup: pickSet.has(work.id), reports: repCount.get(work.id) ?? 0 }))
      .filter((x) => x.owner && (!q || matchesSearch(`${x.work.title} ${x.owner.displayName}`, q)))
  },
  async setWorkHidden(id: string, hidden: boolean, reason: string): Promise<void> {
    await rpc('admin_set_work_hidden', { p_work: id, p_hidden: hidden, p_reason: reason })
    emit()
  },
  async setPickup(id: string, on: boolean): Promise<void> {
    if (on) await run(sb().from('pickups').upsert({ work_id: id, created_by: state.userId }))
    else await run(sb().from('pickups').delete().eq('work_id', id))
    emit()
  },

  // ---------- 一斉配信（A-07〜A-09 / ZS-BC） ----------
  async broadcasts(): Promise<Broadcast[]> {
    const rows = (await run(sb().from('broadcasts').select('*').neq('kind', 'news').order('created_at', { ascending: false }).limit(200))) as Row[]
    return rows.map(toBroadcast)
  },
  async broadcast(id: string): Promise<Broadcast | null> {
    const row = await run(sb().from('broadcasts').select('*').eq('id', id).maybeSingle())
    return row ? toBroadcast(row) : null
  },
  async estimateAudience(audience: Broadcast['audience'], q: SegmentQuery | null): Promise<number> {
    return rpc<number>('admin_estimate_audience', { p_audience: audience, p_query: q ?? {} })
  },
  async saveBroadcast(input: Partial<Broadcast> & { id?: string }): Promise<Broadcast> {
    if (input.bubbles && input.bubbles.length > LIMITS.broadcastBubbles) throw new ApiError('invalid', '吹き出しは5つまでです')
    const row = broadcastRow(input)
    let saved: Row
    const existing = input.id ? await run(sb().from('broadcasts').select('id,status').eq('id', input.id).maybeSingle()) : null
    if (existing) {
      if ((existing as Row).status === 'sent') throw new ApiError('invalid', '送信済みの配信は編集できません')
      saved = (await run(sb().from('broadcasts').update(row).eq('id', input.id!).select('*').single())) as Row
    } else {
      saved = (await run(
        sb()
          .from('broadcasts')
          .insert({ ...row, ...(input.id ? { id: input.id } : {}), status: 'draft', created_by: state.userId })
          .select('*')
          .single(),
      )) as Row
    }
    const b = toBroadcast(saved)
    b.targetCount = await admin.estimateAudience(b.audience, b.segmentQuery)
    emit()
    return b
  },
  /** ZS-BC-06 承認フロー：配信担当は承認依頼だけ */
  async requestApproval(id: string): Promise<void> {
    const b = await admin.broadcast(id)
    if (!b) throw new ApiError('not_found', '配信が見つかりません')
    validateBroadcast(b)
    await rpc('admin_request_approval', { p_id: id })
    emit()
  },
  /** 承認して送信（予約時刻があれば予約、なければ即時） */
  async approveAndSend(id: string): Promise<void> {
    const b = await admin.broadcast(id)
    if (!b) throw new ApiError('not_found', '配信が見つかりません')
    validateBroadcast(b)
    await rpc('admin_send_broadcast', { p_id: id })
    emit()
  },
  /** ZS-BC-05 テスト送信（運営メンバーだけへ） */
  async testSend(id: string): Promise<number> {
    const b = await admin.broadcast(id)
    if (!b) throw new ApiError('not_found', '配信が見つかりません')
    validateBroadcast(b)
    const n = await rpc<number>('admin_test_send', { p_id: id })
    emit()
    return Number(n ?? 0)
  },
  /** ZS-BC-07 送信後24時間以内の取り消し・予約の取り消し */
  async cancelBroadcast(id: string): Promise<void> {
    await rpc('admin_cancel_broadcast', { p_id: id })
    emit()
  },
  async deleteBroadcast(id: string): Promise<void> {
    await rpc('admin_delete_broadcast', { p_id: id })
    emit()
  },
  /** ZS-BC-08 効果測定 */
  async broadcastReport(id: string) {
    const b = await admin.broadcast(id)
    if (!b) throw new ApiError('not_found', '配信が見つかりません')
    const r = await rpc<Row>('admin_broadcast_report', { p_id: id })
    const labels = new Map<string, string>()
    for (const bubble of b.bubbles) {
      const cards = bubble.type === 'card' ? [bubble.card] : bubble.type === 'carousel' ? bubble.cards : []
      for (const c of cards) for (const btn of c.buttons ?? []) labels.set(btn.key, `${c.title}：${btn.label}`)
    }
    const target = Number(r?.target ?? b.targetCount)
    const reads = Number(r?.reads ?? 0)
    const clickers = Number(r?.clickers ?? 0)
    return {
      broadcast: b,
      target,
      pushDelivered: Number(r?.push_delivered ?? 0),
      reads,
      clickers,
      openRate: target ? reads / target : 0,
      clickRate: target ? clickers / target : 0,
      buttons: Object.entries((r?.buttons ?? {}) as Record<string, number>).map(([key, count]) => ({
        key,
        label: labels.get(key) ?? key,
        count: Number(count),
      })),
    }
  },

  // ---------- バナー（A-12 / ZS-BC-10） ----------
  async banners(): Promise<Banner[]> {
    const rows = (await run(sb().from('banners').select('*').order('starts_at', { ascending: false }))) as Row[]
    return rows.map(toBanner)
  },
  async saveBanner(input: Omit<Banner, 'id'> & { id?: string }): Promise<void> {
    if (!input.title.trim()) throw new ApiError('invalid', 'タイトルを入力してください')
    if (new Date(input.endsAt) <= new Date(input.startsAt)) throw new ApiError('invalid', '掲出終了は開始より後にしてください')
    if (input.id) await run(sb().from('banners').update(bannerRow(input)).eq('id', input.id))
    else await run(sb().from('banners').insert(bannerRow(input)))
    await loadPublic()
    emit()
  },
  async deleteBanner(id: string): Promise<void> {
    await run(sb().from('banners').delete().eq('id', id))
    await loadPublic()
    emit()
  },

  // ---------- AIニュース（A-10 / ZS-NEWS） ----------
  async newsToday() {
    const date = jstDateKey(new Date())
    const [digests, sources] = await Promise.all([
      run(sb().from('news_digests').select('*').order('date', { ascending: false }).limit(15)),
      run(sb().from('news_sources').select('*').order('created_at')),
    ])
    const list = (digests as Row[]).map(toDigest)
    const digest = list.find((g) => g.date === date) ?? null
    const items = digest ? ((await run(sb().from('news_items').select('*').eq('digest_id', digest.id))) as Row[]).map(toNewsItem) : []
    const srcs = (sources as Row[]).map(toSource)
    return {
      digest,
      selected: items.filter((n) => n.rank != null).sort((a, b) => a.rank! - b.rank!),
      candidates: items.filter((n) => n.rank == null).sort((a, b) => b.score - a.score),
      sources: srcs,
      history: list.filter((g) => g.date !== date).slice(0, 14),
      reactions: srcs.map((s) => ({ source: s, useful: 0 })),
    }
  },
  /** 収集から要約までを今すぐ実行する（Edge Function `ai-news`） */
  async runNews(_opts: { failSummaryForDemo?: boolean } = {}): Promise<void> {
    void _opts
    const { error } = await sb().invoke('ai-news', { step: 'collect' })
    if (error) throw new ApiError('invalid', 'AIニュースの処理を開始できませんでした。Edge Function「ai-news」を配置して、もう一度お試しください')
    emit()
  },
  async updateNewsItem(id: string, patch: { titleJa?: string; summaryJa?: string }): Promise<void> {
    if (patch.summaryJa && patch.summaryJa.length > 120) throw new ApiError('invalid', '要約は120文字以内にしてください')
    const row: Row = {}
    if (patch.titleJa !== undefined) row.title_ja = patch.titleJa
    if (patch.summaryJa !== undefined) row.summary_ja = patch.summaryJa
    await run(sb().from('news_items').update(row).eq('id', id))
    emit()
  },
  async reorderNews(digestId: string, ids: string[]): Promise<void> {
    const rows = (await run(sb().from('news_items').select('id').eq('digest_id', digestId))) as Row[]
    await Promise.all(
      rows.map((r) =>
        run(
          sb()
            .from('news_items')
            .update({ rank: ids.includes(r.id) ? ids.indexOf(r.id) + 1 : null })
            .eq('id', r.id),
        ),
      ),
    )
    emit()
  },
  async replaceNews(selectedId: string, candidateId: string): Promise<void> {
    const a = (await run(sb().from('news_items').select('rank').eq('id', selectedId).single())) as Row
    await run(sb().from('news_items').update({ rank: null }).eq('id', selectedId))
    await run(sb().from('news_items').update({ rank: a.rank }).eq('id', candidateId))
    emit()
  },
  /** 「承認して配信」：配信は設定した時刻に ai-news（deliver）が行う。時刻を過ぎていれば次の1分以内に届く */
  async approveNews(digestId: string): Promise<'sent' | 'approved'> {
    await rpc('admin_approve_news', { p_digest: digestId })
    emit()
    return 'approved'
  },
  async saveSource(input: Omit<NewsSource, 'id' | 'lastSuccessAt' | 'failureCount'> & { id?: string }): Promise<void> {
    try {
      new URL(input.feedUrl)
    } catch {
      throw new ApiError('invalid', 'フィードURLの形式が正しくありません')
    }
    const row = {
      name: input.name,
      feed_url: input.feedUrl,
      lang: input.lang,
      weight: input.weight,
      enabled: input.enabled,
      terms_checked_at: input.termsCheckedAt,
    }
    if (input.id) await run(sb().from('news_sources').update(row).eq('id', input.id))
    else await run(sb().from('news_sources').insert(row))
    emit()
  },
  async deleteSource(id: string): Promise<void> {
    await run(sb().from('news_sources').delete().eq('id', id))
    emit()
  },

  // ---------- サポート受信箱（A-11 / ZS-ADM-20） ----------
  async supportThreads() {
    const rows = (await run(sb().from('support_threads').select('*').order('last_user_message_at', { ascending: false }).limit(200))) as Row[]
    const threads = rows.map(toSupportThread)
    const pm = await adminProfiles(threads.map((t) => t.userId))
    const lasts = await Promise.all(
      threads.map((t) =>
        run(sb().from('messages').select('*').eq('room_id', t.roomId).order('id', { ascending: false }).limit(1)).then((r) => (r as Row[])[0]),
      ),
    )
    return threads
      .map((thread, i) => ({ thread, user: pm.get(thread.userId)!, last: lasts[i] ? toMessage(lasts[i]) : undefined! }))
      .filter((x) => x.user && x.last)
  },
  async supportMessages(roomId: string) {
    const rows = (await run(sb().from('messages').select('*').eq('room_id', roomId).order('id'))) as Row[]
    return rows.map(toMessage)
  },
  async supportReply(roomId: string, body: string, signName?: string): Promise<void> {
    if (!body.trim()) throw new ApiError('invalid', '返信を入力してください')
    await rpc('admin_support_reply', { p_room: roomId, p_body: body, p_sign_name: signName || null })
    emit()
  },
  async updateSupport(roomId: string, patch: { status?: 'open' | 'pending' | 'closed'; assigneeId?: string | null }): Promise<void> {
    const row: Row = {}
    if (patch.status) row.status = patch.status
    if (patch.assigneeId !== undefined) row.assignee_id = patch.assigneeId
    await run(sb().from('support_threads').update(row).eq('room_id', roomId))
    emit()
  },
  supportTemplates() {
    if (!templatesRequested && state.adminRole) {
      templatesRequested = true
      void loadTemplates().then(emit)
    }
    return state.supportTemplates
  },

  // ---------- マスタ（A-13 / ZS-ADM-21） ----------
  async saveMaster(kind: 'categories' | 'techs', input: { id?: string; name: string }): Promise<void> {
    const name = input.name.trim()
    if (!name) throw new ApiError('invalid', '名前を入力してください')
    const list = kind === 'categories' ? state.categories : state.techs
    if (list.some((m) => m.normalizedName === normalizeSearch(name) && m.id !== input.id)) throw new ApiError('conflict', '同じ名前がすでにあります')
    if (input.id)
      await run(
        sb()
          .from(kind)
          .update({ name, normalized_name: normalizeSearch(name) })
          .eq('id', input.id),
      )
    else
      await run(
        sb()
          .from(kind)
          .insert({ name, normalized_name: normalizeSearch(name), sort_order: list.length }),
      )
    await loadPublic()
    emit()
  },
  async moveMaster(kind: 'categories' | 'techs', id: string, dir: -1 | 1): Promise<void> {
    const list = [...(kind === 'categories' ? state.categories : state.techs)].sort((a, b) => a.sortOrder - b.sortOrder)
    const i = list.findIndex((m) => m.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    const a = list[i]
    const b = list[j]
    // 並び順の値が重なっていても入れ替わるよう、位置の番号を振り直す
    await run(sb().from(kind).update({ sort_order: j }).eq('id', a.id))
    await run(sb().from(kind).update({ sort_order: i }).eq('id', b.id))
    await loadPublic()
    emit()
  },
  async deleteMaster(kind: 'categories' | 'techs', id: string): Promise<void> {
    const used =
      kind === 'categories'
        ? await sb().from('works').select('id', { count: 'exact', head: true }).eq('category_id', id)
        : await sb().from('work_techs').select('work_id', { count: 'exact', head: true }).eq('tech_id', id)
    if ((used.count ?? 0) > 0) throw new ApiError('conflict', '作品で使われているため削除できません')
    await run(sb().from(kind).delete().eq('id', id))
    await loadPublic()
    emit()
  },
  /** タグの統合：from を to にまとめる */
  async mergeTags(from: string, to: string): Promise<number> {
    const n = await rpc<number>('admin_merge_tags', { p_from: from, p_to: to })
    await loadPublic()
    emit()
    return Number(n ?? 0)
  },
  async saveNgWord(word: string, severity: 'warn' | 'block'): Promise<void> {
    if (!word.trim()) throw new ApiError('invalid', 'NGワードを入力してください')
    await run(sb().from('ng_words').upsert({ word: word.trim(), severity }, { onConflict: 'word' }))
    const rows = (await run(sb().from('ng_words').select('*'))) as Row[]
    state.ngWords = rows.map((r) => ({ id: r.id, word: r.word, severity: r.severity }))
    emit()
  },
  async deleteNgWord(id: string): Promise<void> {
    await run(sb().from('ng_words').delete().eq('id', id))
    state.ngWords = state.ngWords.filter((w) => w.id !== id)
    emit()
  },
  async saveTemplate(input: { id?: string; title: string; body: string }): Promise<void> {
    if (input.id) await run(sb().from('support_templates').update({ title: input.title, body: input.body }).eq('id', input.id))
    else await run(sb().from('support_templates').insert({ title: input.title, body: input.body }))
    await loadTemplates()
    emit()
  },

  // ---------- 運営メンバー（A-14 / ZS-ADM-26） ----------
  async members() {
    const rows = (await run(sb().from('admin_members').select('*').order('created_at'))) as Row[]
    const list = rows.map(toAdminMember)
    const pm = await adminProfiles(list.map((m) => m.userId))
    return list.map((member) => ({ member, profile: pm.get(member.userId)! })).filter((x) => x.profile)
  },
  async setMemberRole(handle: string, role: AdminRole | null): Promise<void> {
    await rpc('admin_set_member_role', { p_handle: handle, p_role: role })
    emit()
  },

  // ---------- 監査ログ（A-15 / ZS-ADM-25） ----------
  async auditLogs(q = ''): Promise<{ log: AuditLog; actor: Profile | undefined }[]> {
    const rows = (await run(sb().from('audit_logs').select('*').order('created_at', { ascending: false }).limit(500))) as Row[]
    const logs = rows.map(toAuditLog)
    const pm = await adminProfiles(logs.map((l) => l.actorId).filter(Boolean))
    return logs
      .map((log) => ({ log, actor: pm.get(log.actorId) }))
      .filter((x) => !q || matchesSearch(`${x.log.action} ${x.log.targetType} ${x.log.targetId} ${x.actor?.displayName ?? ''}`, q))
  },
  async auditCsv(): Promise<string> {
    const list = await admin.auditLogs()
    const esc = (v: unknown) => `"${String(typeof v === 'string' ? v : JSON.stringify(v ?? '')).replaceAll('"', '""')}"`
    const rows = list.map(({ log, actor }) =>
      [formatDateTime(log.createdAt), actor?.handle ?? log.actorId, log.action, log.targetType, log.targetId, log.before, log.after].map(esc).join(','),
    )
    return ['日時(JST),操作者,操作,対象種別,対象ID,変更前,変更後', ...rows].join('\n')
  },

  // ---------- システム設定（A-16 / ZS-ADM-22） ----------
  settings(): AppSettings {
    return state.appSettings
  },
  async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    await rpc('admin_update_settings', { p_values: appSettingsRows(patch) })
    state.appSettings = { ...state.appSettings, ...patch }
    await loadPublic()
    emit()
  },

  /** 個人データの出力（オーナーのみ） */
  async exportUser(id: string): Promise<string> {
    const d = await rpc<Row>('admin_export_user', { p_user: id })
    return JSON.stringify(d, null, 2)
  },
}
