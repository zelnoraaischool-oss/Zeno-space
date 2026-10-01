/**
 * PWA アイコンを生成する（15.4：192px、512px、マスカブル（安全領域80%）、iPhone 用180px、通知用の単色、OGP 既定画像）。
 * 使い方：node scripts/generate-icons.mjs（Playwright の Chromium を使う）
 */
import { chromium } from '@playwright/test'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'

const exe = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined)
const out = new URL('../public/icons/', import.meta.url)
mkdirSync(out, { recursive: true })

const mark = (size, scale = 1, bg = '#0B0D17', mono = false) => {
  const s = size * scale
  const o = (size - s) / 2
  const fill = mono ? '#FFFFFF' : 'url(#g)'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C5CFF"/><stop offset="1" stop-color="#22D3EE"/></linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.4" r="0.6"><stop offset="0" stop-color="#6A4DF5" stop-opacity=".35"/><stop offset="1" stop-color="#6A4DF5" stop-opacity="0"/></radialGradient></defs>
  ${bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>${mono ? '' : `<rect width="${size}" height="${size}" fill="url(#glow)"/>`}` : ''}
  <g transform="translate(${o} ${o}) scale(${s / 32})">
    <circle cx="16" cy="16" r="7" fill="${fill}"/>
    <ellipse cx="16" cy="16" rx="13" ry="4.5" fill="none" stroke="${fill}" stroke-width="1.6" transform="rotate(-20 16 16)"/>
  </g></svg>`
}

const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C5CFF"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs>
<rect width="1200" height="630" fill="#0B0D17"/><circle cx="960" cy="315" r="300" fill="#6A4DF5" opacity=".18"/>
<g transform="translate(860 215) scale(6.25)"><circle cx="16" cy="16" r="7" fill="url(#g)"/><ellipse cx="16" cy="16" rx="13" ry="4.5" fill="none" stroke="url(#g)" stroke-width="1.6" transform="rotate(-20 16 16)"/></g>
<text x="90" y="290" font-family="sans-serif" font-size="96" font-weight="700" fill="#EEF0FF">zeno<tspan fill="#22D3EE">space</tspan></text>
<text x="90" y="380" font-family="sans-serif" font-size="40" fill="#A3A8C3">つくったものが、会話のはじまりになる。</text></svg>`

const targets = [
  ['icon-192.png', mark(192, 0.62), 192, 192],
  ['icon-512.png', mark(512, 0.62), 512, 512],
  ['icon-maskable-512.png', mark(512, 0.5), 512, 512],
  ['apple-touch-icon-180.png', mark(180, 0.62), 180, 180],
  ['badge-96.png', mark(96, 0.9, '', true), 96, 96],
  ['og-default.png', og, 1200, 630],
]

const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage()
for (const [name, svg, w, h] of targets) {
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } })
  writeFileSync(new URL(name, out), buf)
  console.log('wrote', name)
}
await browser.close()
