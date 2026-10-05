/**
 * モック用のサムネイル画像（SVG）。外部へのリクエストを出さないために端末内で生成する。
 * Supabase / R2 接続後は使わない。
 */
import type { WorkType } from '../types'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/**
 * 参考画像（灰色のコンクリートと深緑）に馴染むよう、色の彩度を落として灰緑に寄せる。
 * 元の色相は残すので、作品どうしの見分けはつく。
 */
export function mute(hex: string, amount = 0.7): string {
  const n = parseInt(hex.slice(1), 16)
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const gray = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11
  const tint = [0x6f, 0x7d, 0x72]
  const out = rgb.map((c, i) => {
    const desat = c + (gray - c) * amount
    return Math.round(desat * 0.8 + tint[i] * 0.2)
  })
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function workThumb(title: string, c1: string, c2: string, type: WorkType, variant = 0, w = 800, h = 500): string {
  const t = esc(title)
  c1 = mute(c1)
  c2 = mute(c2)
  let body: string
  if (type === 'hp' || type === 'lp') {
    body = `
      <rect x="0" y="0" width="${w}" height="44" fill="rgba(0,0,0,.25)"/>
      <circle cx="28" cy="22" r="7" fill="rgba(255,255,255,.7)"/>
      <rect x="${w - 260}" y="16" width="44" height="12" rx="6" fill="rgba(255,255,255,.5)"/>
      <rect x="${w - 200}" y="16" width="44" height="12" rx="6" fill="rgba(255,255,255,.5)"/>
      <rect x="${w - 140}" y="12" width="100" height="20" rx="10" fill="rgba(255,255,255,.85)"/>
      <text x="56" y="${h * 0.42}" font-family="serif" font-size="${Math.min(36, 480 / Math.max(6, title.length))}" font-weight="600" letter-spacing="2" fill="#fff">${t}</text>
      <rect x="56" y="${h * 0.5}" width="${w * 0.42}" height="12" rx="6" fill="rgba(255,255,255,.6)"/>
      <rect x="56" y="${h * 0.56}" width="${w * 0.32}" height="12" rx="6" fill="rgba(255,255,255,.45)"/>
      <rect x="56" y="${h * 0.66}" width="150" height="40" rx="20" fill="#fff"/>
      <rect x="${w * 0.6}" y="${h * 0.24}" width="${w * 0.32}" height="${h * 0.52}" rx="18" fill="rgba(255,255,255,.18)"/>
      <circle cx="${w * 0.76}" cy="${h * 0.5}" r="${h * 0.14 + variant * 4}" fill="rgba(255,255,255,.35)"/>`
  } else if (type === 'app') {
    body = `
      <rect x="${w / 2 - 95}" y="40" width="190" height="${h - 40}" rx="30" fill="#17322a" opacity=".85"/>
      <rect x="${w / 2 - 80}" y="70" width="160" height="80" rx="14" fill="${c2}"/>
      <rect x="${w / 2 - 80}" y="165" width="160" height="14" rx="7" fill="rgba(255,255,255,.6)"/>
      <rect x="${w / 2 - 80}" y="190" width="110" height="14" rx="7" fill="rgba(255,255,255,.4)"/>
      <rect x="${w / 2 - 80}" y="225" width="75" height="75" rx="14" fill="rgba(255,255,255,.2)"/>
      <rect x="${w / 2 + 5}" y="225" width="75" height="75" rx="14" fill="rgba(255,255,255,.2)"/>
      <text x="40" y="${h - 40}" font-family="serif" font-size="28" font-weight="600" letter-spacing="2" fill="#fff">${t}</text>`
  } else if (type === 'video') {
    body = `
      <circle cx="${w / 2}" cy="${h / 2}" r="56" fill="rgba(0,0,0,.45)"/>
      <path d="M${w / 2 - 16} ${h / 2 - 26} L${w / 2 + 30} ${h / 2} L${w / 2 - 16} ${h / 2 + 26} Z" fill="#fff"/>
      <text x="40" y="${h - 40}" font-family="serif" font-size="28" font-weight="600" letter-spacing="2" fill="#fff">${t}</text>`
  } else {
    body = `
      <circle cx="${w * 0.3}" cy="${h * 0.45}" r="${h * 0.28}" fill="rgba(255,255,255,.22)"/>
      <circle cx="${w * 0.62}" cy="${h * 0.55}" r="${h * 0.2 + variant * 6}" fill="rgba(255,255,255,.3)"/>
      <path d="M0 ${h * 0.8} Q ${w * 0.3} ${h * 0.6} ${w * 0.55} ${h * 0.78} T ${w} ${h * 0.7} V ${h} H 0 Z" fill="rgba(0,0,0,.2)"/>
      <text x="40" y="${h - 36}" font-family="serif" font-size="26" font-weight="600" letter-spacing="2" fill="#fff">${t}</text>`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>${body}</svg>`
  return svgUrl(svg)
}

export function coverArt(c1: string, c2: string): string {
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <rect width="1200" height="400" fill="url(#g)"/>
  <circle cx="980" cy="120" r="70" fill="rgba(255,255,255,.18)"/>
  <ellipse cx="980" cy="120" rx="160" ry="34" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/>
  <circle cx="200" cy="300" r="3" fill="#fff"/><circle cx="420" cy="80" r="2" fill="#fff"/><circle cx="640" cy="260" r="2.5" fill="#fff"/>
  </svg>`)
}

/** AIニュースのカテゴリ別イラスト（記事画像は転載しない：9.3） */
export function newsArt(category: string): string {
  const palette: Record<string, [string, string, string]> = {
    model: ['#1f4d3b', '#9cc9ae', 'M60 70 L100 40 L140 70 L100 100 Z'],
    product: ['#3a3f3c', '#c9b9a6', 'M50 50 H150 V110 H50 Z'],
    research: ['#2c3e40', '#a9c4b6', 'M100 30 A45 45 0 1 1 99.9 30 Z'],
    policy: ['#3f3a2f', '#d8c7a0', 'M100 30 L150 110 H50 Z'],
    business: ['#2b3a33', '#c9d8cf', 'M50 110 V80 H75 V110 M90 110 V60 H115 V110 M130 110 V40 H155 V110'],
  }
  const [bg, fg, path] = palette[category] ?? palette.model
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="140" viewBox="0 0 200 140">
  <rect width="200" height="140" fill="${bg}"/>
  <ellipse cx="100" cy="72" rx="90" ry="22" fill="none" stroke="${fg}" stroke-opacity=".4"/>
  <path d="${path}" fill="none" stroke="${fg}" stroke-width="4" stroke-linejoin="round"/>
  <circle cx="30" cy="25" r="2" fill="#fff"/><circle cx="170" cy="120" r="2" fill="#fff"/></svg>`)
}

export const AVATAR_COLORS = ['#1F4D3B', '#3D6B52', '#5E7F6E', '#7A6A4F', '#8A5A44', '#4A5E6A', '#6B5B73', '#2F5D62']

export function colorFor(seed: string): string {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
