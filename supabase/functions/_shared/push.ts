// Web Push（VAPID）。失効の応答（404/410）を受けた購読は削除する（16.3 push_subscriptions）
import webpush from 'npm:web-push@3'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:ops@example.com', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)

export interface PushPayload {
  title: string
  body: string
  url: string
  tag?: string // 同じトークの通知は1つにまとめる
}

export async function pushToUsers(db: SupabaseClient, userIds: string[], payload: PushPayload): Promise<number> {
  if (!userIds.length) return 0
  const { data: subs } = await db.from('push_subscriptions').select('id, user_id, endpoint, keys, failure_count').in('user_id', userIds)
  const { data: settings } = await db.from('user_settings').select('user_id, quiet_hours, hide_push_body').in('user_id', userIds)
  const byUser = new Map((settings ?? []).map((s) => [s.user_id, s]))
  let delivered = 0
  await Promise.all(
    (subs ?? []).map(async (s) => {
      const st = byUser.get(s.user_id)
      if (st && inQuietHours(st.quiet_hours)) return // おやすみモード：Push は鳴らさず通知センターだけ
      const body = st?.hide_push_body ? '新しい通知があります' : payload.body
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ ...payload, body }), { TTL: 60 * 60 * 24 })
        delivered++
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', s.id)
        else await db.from('push_subscriptions').update({ failure_count: (s.failure_count ?? 0) + 1 }).eq('id', s.id)
      }
    }),
  )
  return delivered
}

function inQuietHours(q: { enabled: boolean; start: string; end: string } | null): boolean {
  if (!q?.enabled) return false
  const now = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
  return q.start <= q.end ? now >= q.start && now < q.end : now >= q.start || now < q.end
}
