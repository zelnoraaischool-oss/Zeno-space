import type { NgWord } from './types'
import { normalizeSearch } from './normalize'

/**
 * ZS-SAFE-03 NG ワード：端末の中で照合する（19.1 サーバーでは本文を解析しない）。
 * 警告語は送信前に確認、重大語は送信を止める。
 */
export function checkNgWords(text: string, words: NgWord[]): { level: 'ok' | 'warn' | 'block'; hits: string[] } {
  const t = normalizeSearch(text)
  const hits = words.filter((w) => t.includes(normalizeSearch(w.word)))
  if (hits.some((h) => h.severity === 'block')) return { level: 'block', hits: hits.map((h) => h.word) }
  if (hits.length) return { level: 'warn', hits: hits.map((h) => h.word) }
  return { level: 'ok', hits: [] }
}
