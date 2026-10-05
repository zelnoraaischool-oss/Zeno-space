// 画像・ファイルの署名付きアップロード URL（Cloudflare R2、有効期限5分：18.3）。
// 端末から R2 へ直接 PUT するため、Worker の CPU 10ms 制限にかからない（17.5）。
import { AwsClient } from 'npm:aws4fetch@1'
import { cors, json, userClient } from '../_shared/supabase.ts'

const r2 = new AwsClient({
  accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
  secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
  service: 's3',
  region: 'auto',
})
const ENDPOINT = `https://${Deno.env.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${Deno.env.get('R2_BUCKET')}`

// SVG は受け付けない。種類と容量はサーバー側でも確かめる
const RULES: Record<string, { mimes: string[]; maxBytes: number }> = {
  work: { mimes: ['image/webp'], maxBytes: 3 * 1024 * 1024 },
  chat: { mimes: ['image/webp'], maxBytes: 3 * 1024 * 1024 },
  avatar: { mimes: ['image/webp'], maxBytes: 1024 * 1024 },
  cover: { mimes: ['image/webp'], maxBytes: 2 * 1024 * 1024 },
  file: { mimes: ['application/pdf', 'application/zip', 'text/plain'], maxBytes: 10 * 1024 * 1024 },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = userClient(req)
  const { data } = await db.auth.getUser()
  if (!data.user) return json({ error: 'unauthenticated' }, 401)
  const { kind, mime, bytes, variants = [''] } = await req.json()
  const rule = RULES[kind]
  if (!rule || !rule.mimes.includes(mime) || bytes > rule.maxBytes) return json({ error: 'invalid_file' }, 400)
  const { data: paused } = await db.from('app_settings').select('value').eq('key', 'heavy_features_paused').maybeSingle()
  if (paused?.value === true && kind === 'chat') return json({ error: 'paused' }, 503)
  const base = `${kind}/${data.user.id}/${crypto.randomUUID()}`
  const urls: Record<string, string> = {}
  for (const v of variants as string[]) {
    const key = `${base}${v ? `_${v}` : ''}.${mime === 'image/webp' ? 'webp' : mime.split('/')[1]}`
    const signed = await r2.sign(new Request(`${ENDPOINT}/${key}?X-Amz-Expires=300`, { method: 'PUT', headers: { 'Content-Type': mime } }), { aws: { signQuery: true } })
    urls[v || 'original'] = signed.url
  }
  return json({ key: base, urls, publicBase: Deno.env.get('R2_PUBLIC_BASE_URL') })
})
