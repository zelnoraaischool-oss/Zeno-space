// ZS-WORK-02 / ZS-CHAT-13 URL の OGP（タイトル、説明、画像）を取得する。
// SSRF 対策（18.3）：内部アドレスへの取得を禁じ、リダイレクトは3回まで、5秒でタイムアウト。
import { cors, json, userClient } from '../_shared/supabase.ts'

const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^::1$/, /^f[cd]/i, /^fe80/i]

async function assertPublicHost(host: string) {
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('blocked_host')
  const ips = [...(await Deno.resolveDns(host, 'A').catch(() => [])), ...(await Deno.resolveDns(host, 'AAAA').catch(() => []))]
  if (!ips.length) throw new Error('dns_failed')
  if (ips.some((ip) => PRIVATE.some((re) => re.test(ip)))) throw new Error('blocked_host')
}

async function fetchSafe(raw: string): Promise<Response> {
  let url = new URL(raw)
  for (let i = 0; i <= 3; i++) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('invalid_scheme')
    await assertPublicHost(url.hostname)
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'zenospace-ogp/1.0' } })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url)
      continue
    }
    return res
  }
  throw new Error('too_many_redirects')
}

function meta(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i')
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i')
  return html.match(re)?.[1] ?? html.match(re2)?.[1] ?? null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const { data: user } = await userClient(req).auth.getUser()
  if (!user.user) return json({ error: 'unauthenticated' }, 401)
  try {
    const { url } = await req.json()
    const res = await fetchSafe(url)
    const html = (await res.text()).slice(0, 512_000)
    return json({
      title: meta(html, 'og:title') ?? html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '',
      description: meta(html, 'og:description') ?? meta(html, 'description') ?? '',
      image: meta(html, 'og:image'),
      // 埋め込みを拒否するサイトはライブプレビューをスクリーンショット表示に切り替える（ZS-WORK-11）
      embeddable: !/deny|sameorigin/i.test(res.headers.get('x-frame-options') ?? '') && !/frame-ancestors\s+('none'|'self')/i.test(res.headers.get('content-security-policy') ?? ''),
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 400)
  }
})
