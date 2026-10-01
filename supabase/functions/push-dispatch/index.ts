// notifications への insert（Database Webhook）を受けて Web Push を送る（ZS-NOTIF-02）。
// いいね通知は1時間ごとにまとめて送る（pg_cron: push-digest-likes）。
import { adminClient, json, requireServiceRole } from '../_shared/supabase.ts'
import { pushToUsers } from '../_shared/push.ts'

const PUSH_KINDS = new Set(['message', 'mention', 'request', 'inquiry', 'saved_search', 'news', 'important'])

Deno.serve(async (req) => {
  const denied = requireServiceRole(req)
  if (denied) return denied
  const db = adminClient()
  const body = await req.json().catch(() => ({}))
  if (body.digest === 'like') {
    const since = new Date(Date.now() - 3600_000).toISOString()
    const { data } = await db.from('notifications').select('user_id, text, target').eq('kind', 'like').gte('created_at', since).is('read_at', null)
    let n = 0
    for (const row of data ?? []) n += await pushToUsers(db, [row.user_id], { title: 'zenospace', body: row.text, url: row.target, tag: row.target })
    return json({ delivered: n })
  }
  // Database Webhook のペイロード：{ type: 'INSERT', record: {...} }
  const rec = body.record
  if (!rec || !PUSH_KINDS.has(rec.kind)) return json({ skipped: true })
  const n = await pushToUsers(db, [rec.user_id], { title: 'zenospace', body: rec.text, url: rec.target, tag: rec.target })
  return json({ delivered: n })
})
