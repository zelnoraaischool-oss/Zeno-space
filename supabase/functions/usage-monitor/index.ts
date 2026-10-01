// 無料枠モニター（ZS-ADM-24）：70%で注意、90%で警告を Slack へ。90%を超えたら重い機能だけ一時停止する（15.1）。
// Supabase Management API と Cloudflare GraphQL API から取れる指標を毎日 usage_snapshots に保存する。
import { adminClient, json, requireServiceRole } from '../_shared/supabase.ts'

const LIMITS: Record<string, number> = {
  db_bytes: 500e6,
  storage_bytes: 1e9,
  realtime_peak: 200,
  realtime_messages: 2e6,
  egress_bytes: 5e9,
  function_invocations: 5e5,
  worker_requests: 1e5,
  r2_bytes: 10e9,
}

Deno.serve(async (req) => {
  const denied = requireServiceRole(req)
  if (denied) return denied
  const db = adminClient()
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date())
  // TODO(接続後)：Supabase Management API（/v1/projects/{ref}/usage）と Cloudflare GraphQL から取得して upsert する
  const { data } = await db.from('usage_snapshots').select('metric, value').eq('date', today)
  const alerts: string[] = []
  let heavy = false
  for (const row of data ?? []) {
    const pct = row.value / LIMITS[row.metric]
    if (pct >= 0.9) {
      alerts.push(`:red_circle: ${row.metric} ${Math.round(pct * 100)}%（判断が必要）`)
      heavy = true
    } else if (pct >= 0.7) alerts.push(`:large_yellow_circle: ${row.metric} ${Math.round(pct * 100)}%`)
  }
  await db.from('app_settings').upsert({ key: 'heavy_features_paused', value: heavy, is_public: true })
  const hook = Deno.env.get('SLACK_WEBHOOK_URL')
  if (hook && alerts.length) await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `zenospace 無料枠モニター\n${alerts.join('\n')}` }) })
  return json({ alerts })
})
