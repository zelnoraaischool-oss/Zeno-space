// 保存した検索条件の新着を1日1回まとめて知らせる（ZS-WORK-09。毎日8:00 JST）
import { adminClient, json, requireServiceRole } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  const denied = requireServiceRole(req)
  if (denied) return denied
  const db = adminClient()
  const { data: searches } = await db.from('saved_searches').select('*').eq('notify', true)
  let sent = 0
  for (const s of searches ?? []) {
    const since = s.last_notified_at ?? s.created_at
    const { data: hits } = await db.rpc('search_works', { p_query: { ...s.query, sort: 'new' }, p_offset: 0, p_limit: 50 })
    if (!hits?.length) continue
    const { count } = await db.from('works').select('id', { count: 'exact', head: true }).in('id', hits.map((h: { id: string }) => h.id)).gt('published_at', since).neq('owner_id', s.user_id)
    if (count) {
      await db.from('notifications').insert({ user_id: s.user_id, kind: 'saved_search', target: '/me', text: `保存した条件「${s.name}」に新着作品が${count}件あります` })
      sent++
    }
    await db.from('saved_searches').update({ last_notified_at: new Date().toISOString() }).eq('id', s.id)
  }
  return json({ sent })
})
