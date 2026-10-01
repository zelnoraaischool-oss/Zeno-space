/**
 * 作品説明の簡易記法（7.2）：見出し（# ）、箇条書き（- ）、リンクのみ。
 * HTML は一切解釈しない（許可した要素以外は除去＝そもそも生成しない）。
 */
export type MarkupBlock = { type: 'h'; text: string } | { type: 'ul'; items: string[] } | { type: 'p'; text: string }

export function parseMarkup(src: string): MarkupBlock[] {
  const blocks: MarkupBlock[] = []
  let para: string[] = []
  let list: string[] | null = null
  const flushPara = () => {
    if (para.length) blocks.push({ type: 'p', text: para.join('\n') })
    para = []
  }
  const flushList = () => {
    if (list) blocks.push({ type: 'ul', items: list })
    list = null
  }
  for (const line of src.split(/\r?\n/)) {
    if (/^#{1,3}\s+/.test(line)) {
      flushPara()
      flushList()
      blocks.push({ type: 'h', text: line.replace(/^#{1,3}\s+/, '') })
    } else if (/^[-*・]\s+/.test(line)) {
      flushPara()
      list ??= []
      list.push(line.replace(/^[-*・]\s+/, ''))
    } else if (line.trim() === '') {
      flushPara()
      flushList()
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara()
  flushList()
  return blocks
}

const URL_RE = /(https?:\/\/[^\s<>"'）)]+)/g

/** テキストを「文字列 / URL」の断片に分ける（ZS-CHAT-10 URL の自動リンク化） */
export function splitLinks(text: string): { text: string; url?: string }[] {
  const out: { text: string; url?: string }[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0
    if (i > last) out.push({ text: text.slice(last, i) })
    out.push({ text: m[0], url: m[0] })
    last = i + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

export function firstUrl(text: string): string | null {
  const m = text.match(URL_RE)
  return m ? m[0] : null
}

export function isSafeHttpUrl(u: string): boolean {
  try {
    const url = new URL(u)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}
