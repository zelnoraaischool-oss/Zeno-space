/**
 * Vercel Routing Middleware：作品とプロフィールの URL だけ、クローラーに OGP を差し込んだ HTML を返す
 * （ZS-WORK-17：共有 URL は OGP カード付きで表示される。要件 17.2 の「Worker で OGP を差し込む」の Vercel 版）。
 * Supabase の環境変数が未設定のあいだは何もしない（モック動作）。
 */
import { next } from '@vercel/functions'

export const config = { matcher: ['/works/:id*', '/u/:handle*'] }

const BOT = /bot|crawler|spider|facebookexternalhit|twitterbot|slackbot|discordbot|line-poker|linkedinbot|embedly|whatsapp|telegrambot/i

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export default async function middleware(request: Request) {
  const url = new URL(request.url)
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!BOT.test(request.headers.get('user-agent') ?? '') || !supabaseUrl || !anonKey) return next()

  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
  let title = 'zenospace'
  let description = 'つくったものが、会話のはじまりになる。'
  let image = `${url.origin}/icons/og-default.png`
  try {
    const [, kind, key] = url.pathname.split('/')
    if (kind === 'works') {
      const res = await fetch(`${supabaseUrl}/rest/v1/works?id=eq.${encodeURIComponent(key)}&select=title,catch_copy,work_media(storage_key,sort_order)`, { headers })
      const [w] = (await res.json()) as { title: string; catch_copy: string; work_media: { storage_key: string; sort_order: number }[] }[]
      if (w) {
        title = `${w.title} | zenospace`
        description = w.catch_copy || description
        const cover = [...w.work_media].sort((a, b) => a.sort_order - b.sort_order)[0]
        if (cover && process.env.VITE_R2_PUBLIC_BASE_URL) image = `${process.env.VITE_R2_PUBLIC_BASE_URL}/${cover.storage_key}_1200.webp`
      }
    } else if (kind === 'u') {
      const res = await fetch(`${supabaseUrl}/rest/v1/profiles?handle=eq.${encodeURIComponent(key)}&select=display_name,bio`, { headers })
      const [p] = (await res.json()) as { display_name: string; bio: string }[]
      if (p) {
        title = `${p.display_name} | zenospace`
        description = p.bio || description
      }
    }
  } catch {
    return next()
  }
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="zenospace">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}"><meta property="og:url" content="${esc(url.href)}">
<meta name="twitter:card" content="summary_large_image"></head><body><a href="${esc(url.href)}">${esc(title)}</a></body></html>`
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=60' } })
}
