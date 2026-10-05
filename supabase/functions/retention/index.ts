// 保持期間を過ぎた R2 のファイルを削除する（16.4）：チャットのファイルは90日、画像の原寸は180日。
import { AwsClient } from 'npm:aws4fetch@1'
import { adminClient, json, requireServiceRole } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  const denied = requireServiceRole(req)
  if (denied) return denied
  const db = adminClient()
  const r2 = new AwsClient({ accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!, secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!, service: 's3', region: 'auto' })
  const endpoint = `https://${Deno.env.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${Deno.env.get('R2_BUCKET')}`
  const { data } = await db.from('attachments').select('id, storage_key').lt('expires_at', new Date().toISOString()).limit(500)
  let deleted = 0
  for (const a of data ?? []) {
    const res = await r2.fetch(`${endpoint}/${a.storage_key}`, { method: 'DELETE' })
    if (res.ok || res.status === 404) {
      await db.from('attachments').delete().eq('id', a.id)
      deleted++
    }
  }
  return json({ deleted })
})
