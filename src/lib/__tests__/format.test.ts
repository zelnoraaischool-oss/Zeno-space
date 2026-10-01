import { describe, expect, it } from 'vitest'
import { formatCount, formatDaySeparator, formatPriceRange, formatReplyTime, formatTime, jstDateKey } from '../format'
import { parseMarkup, splitLinks } from '../markup'
import { checkNgWords } from '../ngwords'
import { activeFilterCount, paramsFromQuery, queryFromParams } from '../query'

describe('表示の書式', () => {
  it('1,000以上は「1.2k」', () => {
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1200)).toBe('1.2k')
    expect(formatCount(1000)).toBe('1k')
    expect(formatCount(25300)).toBe('25k')
  })
  it('参考価格帯「5万〜10万円」', () => {
    expect(formatPriceRange(50000, 100000)).toBe('5万〜10万円')
    expect(formatPriceRange(30000, null)).toBe('3万円〜')
    expect(formatPriceRange(null, null)).toBeNull()
  })
  it('日時は JST で表示する', () => {
    expect(formatTime('2026-09-30T15:30:00Z')).toBe('00:30')
    expect(jstDateKey('2026-09-30T15:30:00Z')).toBe('2026-10-01')
  })
  it('トークの日付区切り：今日・昨日・日付', () => {
    const now = new Date('2026-10-01T03:00:00Z')
    expect(formatDaySeparator('2026-10-01T01:00:00Z', now)).toBe('今日')
    expect(formatDaySeparator('2026-09-30T01:00:00Z', now)).toBe('昨日')
    expect(formatDaySeparator('2026-09-28T01:00:00Z', now)).toBe('9月28日(月)')
  })
  it('平均返信時間', () => {
    expect(formatReplyTime(2.5 * 3600_000)).toBe('3時間以内')
    expect(formatReplyTime(null)).toBeNull()
  })
})

describe('簡易記法（7.2：見出し、箇条書き、リンクのみ）', () => {
  it('HTML は解釈せず文字として扱う', () => {
    const blocks = parseMarkup('# 概要\n<script>alert(1)</script>\n- 項目1\n- 項目2')
    expect(blocks[0]).toEqual({ type: 'h', text: '概要' })
    expect(blocks[1]).toEqual({ type: 'p', text: '<script>alert(1)</script>' })
    expect(blocks[2]).toEqual({ type: 'ul', items: ['項目1', '項目2'] })
  })
  it('URL を自動でリンク化する', () => {
    const parts = splitLinks('詳しくは https://example.com/a を見てください')
    expect(parts.map((p) => p.url).filter(Boolean)).toEqual(['https://example.com/a'])
  })
})

describe('NG ワード（端末内で照合）', () => {
  const words = [
    { id: '1', word: '必ず儲かる', severity: 'block' as const },
    { id: '2', word: 'LINE交換', severity: 'warn' as const },
  ]
  it('重大語は送信を止め、警告語は確認する', () => {
    expect(checkNgWords('これは必ず儲かる話です', words).level).toBe('block')
    expect(checkNgWords('ｌｉｎｅ交換しませんか', words).level).toBe('warn')
    expect(checkNgWords('よろしくお願いします', words).level).toBe('ok')
  })
})

describe('絞り込み条件の URL（ZS-WORK-07）', () => {
  it('URL と条件を往復できる', () => {
    const q = { q: 'カフェ', types: ['lp' as const, 'hp' as const], openOnly: true, priceMin: 50000, sort: 'likes' as const }
    const back = queryFromParams(paramsFromQuery(q))
    expect(back.q).toBe('カフェ')
    expect(back.types).toEqual(['lp', 'hp'])
    expect(back.openOnly).toBe(true)
    expect(back.priceMin).toBe(50000)
    expect(back.sort).toBe('likes')
    expect(activeFilterCount(back)).toBe(4)
  })
})
