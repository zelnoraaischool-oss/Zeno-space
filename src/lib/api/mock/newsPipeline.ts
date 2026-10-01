/**
 * 9.3 AIニュース自動配信のパイプライン（モック）。
 * 本番は Edge Function `ai-news`：RSS 取得 → URL 正規化と見出し類似度で重複除去 →
 * 重み・キーワード・新しさで採点 → Workers AI で120文字要約。
 */
import { db } from './core'
import { uuid, nowIso } from '../../ids'
import { normalizeUrl, normalizeSearch } from '../../normalize'
import { jstDateKey } from '../../format'
import type { NewsCategory, NewsDigest, NewsItem } from '../../types'

const POOL: [string, string, NewsCategory, 'ja' | 'en'][] = [
  ['Frontier model update improves long-context reasoning', '最新モデルが長文の推論性能を改善', 'model', 'en'],
  ['New open-weight model released for on-device use', '端末で動く公開モデルが登場', 'model', 'en'],
  ['画像生成AIに動画の書き出し機能', '画像生成AIに動画の書き出し機能', 'product', 'ja'],
  ['Agents can now operate spreadsheets end to end', 'AIエージェントが表計算を最後まで操作可能に', 'product', 'en'],
  ['Study measures hallucination rates across benchmarks', '各ベンチマークでの誤回答率を比較した研究', 'research', 'en'],
  ['生成AIの著作権に関する新たな指針案', '生成AIの著作権に関する新たな指針案', 'policy', 'ja'],
  ['EU publishes guidance on general-purpose AI', 'EUが汎用AIに関する指針を公表', 'policy', 'en'],
  ['AI startup raises funding for coding assistant', 'コーディング支援AIの企業が資金調達', 'business', 'en'],
  ['国内企業の生成AI導入率が5割を超える', '国内企業の生成AI導入率が5割を超える', 'business', 'ja'],
  ['Voice assistant gets faster Japanese responses', '音声アシスタントの日本語応答が高速化', 'product', 'en'],
  ['Research: small models distilled from larger ones', '大型モデルから小型モデルを蒸留する研究', 'research', 'en'],
  ['【PR】AIで必ず稼げる副業セミナー', '【PR】AIで必ず稼げる副業セミナー', 'business', 'ja'],
]

function similarity(a: string, b: string): number {
  const A = new Set(normalizeSearch(a).split(''))
  const B = new Set(normalizeSearch(b).split(''))
  const inter = [...A].filter((x) => B.has(x)).length
  return inter / Math.max(1, Math.min(A.size, B.size))
}

/** 今日の分を作る。承認モードなら下書き（pending）で止める */
export function runNewsPipeline(opts: { failSummaryForDemo?: boolean } = {}): NewsDigest {
  const d = db()
  const date = jstDateKey(new Date())
  let dg = d.newsDigests.find((x) => x.date === date)
  if (dg && dg.status === 'sent') return dg
  if (!dg) {
    dg = { id: uuid(), date, status: 'collecting', stage: 'collect', failedStage: null, approvedBy: null, sentAt: null, broadcastId: null }
    d.newsDigests.push(dg)
  }
  d.newsItems = d.newsItems.filter((n) => n.digestId !== dg!.id)
  const s = d.settings.news
  const sources = d.newsSources.filter((x) => x.enabled)

  // 1. 収集（失敗した情報源はダッシュボードに出す）
  const collected: Omit<NewsItem, 'id'>[] = []
  sources.forEach((src, si) => {
    const failed = src.failureCount >= 3
    if (failed) return
    src.lastSuccessAt = nowIso()
    POOL.filter((_, i) => i % sources.length === si || i % 3 === si % 3).forEach(([title, ja, category, lang], i) => {
      if (lang !== src.lang && i % 2) return
      collected.push({
        sourceId: src.id,
        url: `https://example.com/${src.name.toLowerCase().replace(/\s+/g, '-')}/${date}/${i}?utm_source=rss`,
        title,
        titleJa: ja,
        summaryJa: null,
        category,
        publishedAt: new Date(Date.now() - (i + 1) * 3600_000).toISOString(),
        score: 0,
        scoreDetail: { weight: 0, keyword: 0, freshness: 0 },
        digestId: dg!.id,
        rank: null,
      })
    })
  })
  dg.stage = 'dedupe'

  // 2. 重複除去：URL の正規化と見出しの類似度
  const unique: typeof collected = []
  for (const c of collected) {
    const url = normalizeUrl(c.url)
    if (unique.some((u) => normalizeUrl(u.url) === url || similarity(u.titleJa, c.titleJa) > 0.85)) continue
    unique.push({ ...c, url })
  }
  dg.stage = 'select'

  // 3. 選定：情報源の重み、キーワード（含める・除く）、新しさ
  const scored = unique
    .filter((c) => !s.excludeKeywords.some((k) => k && c.titleJa.includes(k)))
    .map((c) => {
      const src = sources.find((x) => x.id === c.sourceId)!
      const weight = Math.round(src.weight * 40)
      const keyword = Math.min(30, s.includeKeywords.filter((k) => k && (c.title + c.titleJa).toLowerCase().includes(k.toLowerCase())).length * 15 + 5)
      const hours = (Date.now() - new Date(c.publishedAt).getTime()) / 3600_000
      const freshness = Math.max(0, Math.round(30 - hours))
      return { ...c, score: weight + keyword + freshness, scoreDetail: { weight, keyword, freshness } }
    })
    .sort((a, b) => b.score - a.score)
  dg.stage = 'summarize'

  // 4. 要約：120文字以内。失敗した日は見出しと出典だけ
  const items: NewsItem[] = scored.map((c, i) => ({
    ...c,
    id: uuid(),
    rank: i < s.count ? i + 1 : null,
    summaryJa: opts.failSummaryForDemo
      ? null
      : `${c.titleJa}。発表によると、提供範囲や料金などの詳細は今後公開される予定。開発者や企業での活用に向けた動きが広がっている。`.slice(0, 120),
  }))
  d.newsItems.push(...items)

  const selected = items.filter((i) => i.rank != null)
  if (selected.length < s.minCount) {
    dg.status = 'skipped'
    dg.failedStage = 'select'
    return dg
  }
  dg.stage = 'review'
  dg.status = 'pending'
  return dg
}
