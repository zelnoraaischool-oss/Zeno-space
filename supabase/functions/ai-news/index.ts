// 9.3 AIニュース自動配信。pg_cron から step=collect（7:00 JST）と step=deliver（毎分）で呼ぶ。
// 1 収集 → 2 重複除去 → 3 選定 → 4 要約 → 5 確認（承認後配信モード）→ 6 配信
// 著作権への配慮：記事本文と画像は保存・転載しない。見出し、120文字以内の独自要約、出典名、リンクのみ（19.6）。
import { adminClient, json, requireServiceRole } from '../_shared/supabase.ts'

interface Settings {
  time: string
  days: 'daily' | 'weekdays'
  mode: 'auto' | 'approval'
  count: number
  minCount: number
  includeKeywords: string[]
  excludeKeywords: string[]
  provider: 'workers-ai' | 'gemini'
}

const jstDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date())

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    u.hash = ''
    for (const k of [...u.searchParams.keys()]) if (k.startsWith('utm_') || k === 'fbclid' || k === 'gclid') u.searchParams.delete(k)
    u.hostname = u.hostname.replace(/^www\./, '')
    return u.toString().replace(/\/$/, '')
  } catch {
    return raw
  }
}

function similarity(a: string, b: string): number {
  const A = new Set(a.toLowerCase())
  const B = new Set(b.toLowerCase())
  const inter = [...A].filter((x) => B.has(x)).length
  return inter / Math.max(1, Math.min(A.size, B.size))
}

function parseFeed(xml: string): { title: string; link: string; published: string }[] {
  const items = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/g)].map((m) => m[0])
  const pick = (s: string, tag: string) => s.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`))?.[1]?.trim() ?? ''
  return items.map((it) => ({
    title: pick(it, 'title').replace(/<[^>]+>/g, ''),
    link: pick(it, 'link') || it.match(/<link[^>]+href="([^"]+)"/)?.[1] || '',
    published: pick(it, 'pubDate') || pick(it, 'published') || pick(it, 'updated'),
  }))
}

/** 4. 要約：Workers AI（初期値）または Gemini。利用者の個人情報は送らない（17.5） */
async function summarize(title: string, provider: Settings['provider'], lang: string): Promise<{ titleJa: string; summaryJa: string } | null> {
  const prompt = `次のAI関連ニュースの見出しから、日本語の見出し（40文字以内）と、120文字以内の日本語の要約を作ってください。見出しにない事実は書かないでください。JSONで {"title":"","summary":""} の形で返してください。\n見出し（${lang}）：${title}`
  try {
    if (provider === 'gemini') {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${Deno.env.get('GEMINI_API_KEY')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }),
      })
      const j = await res.json()
      const out = JSON.parse(j.candidates[0].content.parts[0].text)
      return { titleJa: String(out.title).slice(0, 60), summaryJa: String(out.summary).slice(0, 120) }
    }
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${Deno.env.get('CF_ACCOUNT_ID')}/ai/run/@cf/meta/llama-3.1-8b-instruct`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('CF_AI_TOKEN')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], max_tokens: 300 }),
    })
    const j = await res.json()
    const out = JSON.parse(String(j.result.response).match(/\{[\s\S]*\}/)?.[0] ?? '{}')
    if (!out.summary) return null
    return { titleJa: String(out.title || title).slice(0, 60), summaryJa: String(out.summary).slice(0, 120) }
  } catch {
    return null // 要約に失敗した記事は見出しと出典だけで配信する
  }
}

async function collect() {
  const db = adminClient()
  const { data: setting } = await db.from('app_settings').select('value').eq('key', 'news').single()
  const s = setting!.value as Settings
  const date = jstDate()
  const day = new Date(`${date}T12:00:00+09:00`).getDay()
  if (s.days === 'weekdays' && (day === 0 || day === 6)) return { skipped: 'weekend' }
  const { data: digest } = await db.from('news_digests').upsert({ date, status: 'collecting', stage: 'collect' }, { onConflict: 'date' }).select().single()
  const { data: sources } = await db.from('news_sources').select('*').eq('enabled', true)
  const since = Date.now() - 24 * 3600_000

  // 1. 収集（取得に失敗した情報源は運営ダッシュボードに表示）
  const raw: { source: NonNullable<typeof sources>[number]; title: string; url: string; published: Date }[] = []
  for (const src of sources ?? []) {
    try {
      const xml = await (await fetch(src.feed_url, { signal: AbortSignal.timeout(10_000) })).text()
      for (const it of parseFeed(xml)) {
        const published = new Date(it.published)
        if (it.link && !Number.isNaN(published.getTime()) && published.getTime() >= since) raw.push({ source: src, title: it.title, url: normalizeUrl(it.link), published })
      }
      await db.from('news_sources').update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq('id', src.id)
    } catch {
      await db.from('news_sources').update({ failure_count: (src.failure_count ?? 0) + 1 }).eq('id', src.id)
    }
  }
  await db.from('news_digests').update({ stage: 'dedupe' }).eq('id', digest!.id)

  // 2. 重複除去：URL の正規化と見出しの類似度
  const unique: typeof raw = []
  for (const r of raw) if (!unique.some((u) => u.url === r.url || similarity(u.title, r.title) > 0.85)) unique.push(r)
  await db.from('news_digests').update({ stage: 'select' }).eq('id', digest!.id)

  // 3. 選定：情報源の重み、キーワード（含める・除く）、新しさ
  const scored = unique
    .filter((r) => !s.excludeKeywords.some((k) => k && r.title.includes(k)))
    .map((r) => {
      const weight = Math.round(Number(r.source.weight) * 40)
      const keyword = Math.min(30, s.includeKeywords.filter((k) => k && r.title.toLowerCase().includes(k.toLowerCase())).length * 15 + 5)
      const freshness = Math.max(0, Math.round(30 - (Date.now() - r.published.getTime()) / 3600_000))
      return { ...r, score: weight + keyword + freshness, detail: { weight, keyword, freshness } }
    })
    .sort((a, b) => b.score - a.score)
  const top = scored.slice(0, s.count)
  if (top.length < s.minCount) {
    await db.from('news_digests').update({ status: 'skipped', failed_stage: 'select' }).eq('id', digest!.id)
    return { skipped: 'not_enough' }
  }
  await db.from('news_digests').update({ stage: 'summarize' }).eq('id', digest!.id)

  // 4. 要約（候補も保存しておき、管理画面で差し替えられるようにする）
  for (const [i, r] of scored.slice(0, s.count + 5).entries()) {
    const sum = i < s.count ? await summarize(r.title, s.provider, r.source.lang) : null
    await db.from('news_items').upsert(
      {
        source_id: r.source.id,
        url: r.url,
        title: r.title,
        title_ja: sum?.titleJa ?? (r.source.lang === 'ja' ? r.title : r.title),
        summary_ja: sum?.summaryJa ?? null,
        published_at: r.published.toISOString(),
        score: r.score,
        score_detail: r.detail,
        digest_id: digest!.id,
        rank: i < s.count ? i + 1 : null,
      },
      { onConflict: 'url' },
    )
  }
  // 5. 確認：承認後配信モードなら運営に通知して待つ
  await db.from('news_digests').update({ stage: 'review', status: s.mode === 'auto' ? 'approved' : 'pending' }).eq('id', digest!.id)
  if (s.mode === 'approval') {
    const { data: admins } = await db.from('admin_members').select('user_id').in('role', ['owner', 'admin', 'publisher'])
    await db.from('notifications').insert((admins ?? []).map((a) => ({ user_id: a.user_id, kind: 'important', target: '/admin/news', text: '今日のAIニュースの下書きができました。確認して承認してください' })))
  }
  return { collected: raw.length, selected: top.length }
}

/** 6. 配信：公式アカウントに1本1カードのカルーセル、ニュース画面に保存、Push「今日のAIニュース 5本」 */
async function deliver() {
  const db = adminClient()
  const { data: setting } = await db.from('app_settings').select('value').eq('key', 'news').single()
  const s = setting!.value as Settings
  const date = jstDate()
  const sendAt = new Date(`${date}T${s.time}:00+09:00`)
  if (Date.now() < sendAt.getTime()) return { waiting: true }
  const { data: digest } = await db.from('news_digests').select('*').eq('date', date).eq('status', 'approved').maybeSingle()
  if (!digest) return { nothing: true }
  const { data: items } = await db.from('news_items').select('*, news_sources(name)').eq('digest_id', digest.id).not('rank', 'is', null).order('rank')
  const [, m, d] = date.split('-').map(Number)
  const wd = ['日', '月', '火', '水', '木', '金', '土'][new Date(`${date}T12:00:00+09:00`).getDay()]
  const cards = [
    { title: `今日のAIニュース ${m}月${d}日(${wd}) ${items!.length}本`, body: '1本ずつめくって読めます' },
    ...items!.map((n) => ({ title: n.title_ja || n.title, body: n.summary_ja ?? `出典：${n.news_sources?.name ?? ''}`, buttons: [{ key: n.id, label: '元記事を読む', url: n.url }] })),
  ]
  const { data: b } = await db
    .from('broadcasts')
    .insert({ title: `AIニュース ${date}`, kind: 'news', status: 'draft', audience: 'all', bubbles: [{ type: 'carousel', cards }], push_text: `今日のAIニュース ${items!.length}本`, approved_by: digest.approved_by })
    .select()
    .single()
  await db.rpc('service_deliver_broadcast', { p_id: b!.id })
  await db.from('news_digests').update({ status: 'sent', stage: 'sent', sent_at: new Date().toISOString(), broadcast_id: b!.id }).eq('id', digest.id)
  return { sent: b!.id }
}

Deno.serve(async (req) => {
  const denied = requireServiceRole(req)
  if (denied) return denied
  const { step } = await req.json().catch(() => ({ step: 'collect' }))
  try {
    return json(step === 'deliver' ? await deliver() : await collect())
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
