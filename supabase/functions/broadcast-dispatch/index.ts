// 一斉配信の Push を 500人ずつに分けて順に送る（9.2）。本文は broadcasts の1件だけ。
import { adminClient, json, requireServiceRole } from '../_shared/supabase.ts'
import { pushToUsers } from '../_shared/push.ts'

const BATCH = 500

Deno.serve(async (req) => {
  const denied = requireServiceRole(req)
  if (denied) return denied
  const db = adminClient()
  const { data: list } = await db.from('broadcasts').select('*').eq('status', 'sent').is('push_sent_at', null).is('canceled_at', null).limit(5)
  let total = 0
  for (const b of list ?? []) {
    // 二重送信を防ぐため先に印を付ける
    const { data: claimed } = await db.from('broadcasts').update({ push_sent_at: new Date().toISOString() }).eq('id', b.id).is('push_sent_at', null).select('id')
    if (!claimed?.length) continue
    const notifyKind = b.kind === 'news' ? 'news' : b.kind === 'important' ? 'important' : 'broadcast'
    let delivered = 0
    for (let offset = 0; ; offset += BATCH) {
      const q = b.audience === 'all'
        ? db.from('profiles').select('id').eq('is_official', false).is('deleted_at', null).neq('status', 'banned').lte('created_at', b.sent_at).range(offset, offset + BATCH - 1)
        : db.from('broadcast_recipients').select('id:user_id').eq('broadcast_id', b.id).range(offset, offset + BATCH - 1)
      const { data: users } = await q
      if (!users?.length) break
      // 種類別の通知設定（一斉配信・AIニュースはオフにできる：ZS-OFC-02）
      const ids = users.map((u) => u.id as string)
      const { data: optOut } = await db.from('user_settings').select('user_id').in('user_id', ids).eq(`notify->>${notifyKind}`, 'false')
      const off = new Set((optOut ?? []).map((o) => o.user_id))
      delivered += await pushToUsers(db, ids.filter((id) => notifyKind === 'important' || !off.has(id)), { title: 'zenospace', body: b.push_text || b.title, url: notifyKind === 'news' ? '/news' : '/talk', tag: `broadcast-${b.id}` })
      if (users.length < BATCH) break
    }
    await db.from('broadcasts').update({ push_delivered: delivered }).eq('id', b.id)
    total += delivered
  }
  return json({ delivered: total })
})
