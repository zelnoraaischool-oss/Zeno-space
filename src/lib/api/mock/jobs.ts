/**
 * 18.4 定期処理のモック。本番は pg_cron（UTC）と Edge Function で実行する
 * （supabase/migrations/0005_cron.sql）。画面を開いている間だけ15秒ごとに回す。
 */
import { db, commit, notify } from './core'
import { deliverBroadcast, deliverDigest, officialSay } from './official'
import { runNewsPipeline } from './newsPipeline'
import { RESTRICTION_INFO } from '../../restrictions'
import { nowIso } from '../../ids'
import { jstDateKey } from '../../format'
import { OFFICIAL_USER_ID } from '../../constants'

export function runJobs(now = new Date()) {
  const d = db()
  let changed = false

  // 期限切れの利用制限の解除（5分ごと）と公式アカウントからの通知（ZS-ADM-04）
  for (const r of d.restrictions) {
    if (r.liftedAt || !r.endsAt || r.kind === 'warning') continue
    if (new Date(r.endsAt) <= now) {
      r.liftedAt = r.endsAt
      const p = d.profiles.find((x) => x.id === r.userId)
      if (p && r.kind === 'freeze') p.status = 'active'
      officialSay(r.userId, `${RESTRICTION_INFO[r.kind].label}が解除されました`, { important: true })
      d.auditLogs.unshift({
        id: crypto.randomUUID(),
        actorId: OFFICIAL_USER_ID,
        action: 'restriction.auto_lift',
        targetType: 'user',
        targetId: r.userId,
        before: { restrictionId: r.id },
        after: null,
        createdAt: nowIso(),
      })
      changed = true
    }
  }

  // 予約配信（1分ごと）
  for (const b of d.broadcasts) {
    if (b.status === 'scheduled' && b.scheduledAt && new Date(b.scheduledAt) <= now) {
      deliverBroadcast(b)
      changed = true
    }
  }

  // AIニュース：7:00 に収集を始め、配信時刻に配信（承認後配信モードは承認を待つ）
  const s = d.settings.news
  const today = jstDateKey(now)
  const jstDay = new Date(`${today}T12:00:00+09:00`).getDay()
  const runDay = s.days === 'daily' || (jstDay !== 0 && jstDay !== 6)
  const [hh, mm] = s.time.split(':').map(Number)
  const sendAt = new Date(`${today}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+09:00`)
  const collectAt = new Date(sendAt.getTime() - 30 * 60_000)
  if (runDay && now >= collectAt) {
    let dg = d.newsDigests.find((g) => g.date === today)
    if (!dg) {
      dg = runNewsPipeline()
      if (dg.status === 'pending' && s.mode === 'approval')
        for (const m of d.adminMembers.filter((m) => ['owner', 'admin', 'publisher'].includes(m.role)))
          notify(m.userId, 'important', { target: '/admin/news', text: '今日のAIニュースの下書きができました。確認して承認してください' })
      changed = true
    }
    if (now >= sendAt && (dg.status === 'approved' || (s.mode === 'auto' && dg.status === 'pending'))) {
      deliverDigest(dg, dg.approvedBy ?? OFFICIAL_USER_ID)
      changed = true
    }
  }

  // 保持期間を過ぎたデータの削除（毎日3:30）
  const trashLimit = now.getTime() - 30 * 86400_000
  const beforeWorks = d.works.length
  d.works = d.works.filter((w) => !(w.status === 'trashed' && w.deletedAt && new Date(w.deletedAt).getTime() < trashLimit))
  const beforeN = d.notifications.length
  d.notifications = d.notifications.filter((n) => now.getTime() - new Date(n.createdAt).getTime() < 90 * 86400_000)
  if (beforeWorks !== d.works.length || beforeN !== d.notifications.length) changed = true

  if (changed) commit()
}

let timer: ReturnType<typeof setInterval> | null = null
export function startJobs() {
  if (timer || typeof window === 'undefined') return
  runJobs()
  timer = setInterval(() => runJobs(), 15_000)
}
