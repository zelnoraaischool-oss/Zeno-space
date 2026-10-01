/**
 * ZS-ONE-02 メールの正規化。
 * 小文字化し、Gmail はドットと「+」以降を除く。DB 側の normalize_email() と同じ規則。
 */
export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase()
  const at = email.lastIndexOf('@')
  if (at < 1) return email
  let local = email.slice(0, at)
  let domain = email.slice(at + 1)
  if (domain === 'googlemail.com') domain = 'gmail.com'
  const plus = local.indexOf('+')
  if (plus >= 0) local = local.slice(0, plus)
  if (domain === 'gmail.com') local = local.replace(/\./g, '')
  return `${local}@${domain}`
}

/**
 * ZS-SRCH-02 日本語の表記ゆれ吸収（PGroonga の NormalizerNFKC + カナ統一に相当する端末側の実装）。
 * 全角英数→半角、半角カナ→全角（NFKC）、カタカナ→ひらがな、小文字化。
 */
export function normalizeSearch(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/g, ' ')
    .trim()
}

export function matchesSearch(haystack: string, query: string): boolean {
  const h = normalizeSearch(haystack)
  return normalizeSearch(query)
    .split(' ')
    .filter(Boolean)
    .every((term) => h.includes(term))
}

/** ZS-AUTH-04 ユーザーID：英数字と _ の 4〜20 文字 */
export const HANDLE_PATTERN = /^[a-zA-Z0-9_]{4,20}$/

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    u.hash = ''
    for (const k of [...u.searchParams.keys()]) {
      if (k.startsWith('utm_') || k === 'fbclid' || k === 'gclid') u.searchParams.delete(k)
    }
    u.hostname = u.hostname.replace(/^www\./, '')
    let s = u.toString()
    if (s.endsWith('/')) s = s.slice(0, -1)
    return s
  } catch {
    return raw.trim()
  }
}
