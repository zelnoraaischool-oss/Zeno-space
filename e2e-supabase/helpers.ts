/**
 * ローカルの Supabase（supabase start）に対して画面を通すための補助。
 * ログインメールは Mailpit（http://127.0.0.1:54324）で受け取り、確認コードを読む。
 */
import { createHmac } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { expect, type Page } from '@playwright/test'

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'

/** 届いたログインメールから確認コード（6〜8桁）を取り出す */
export async function mailCode(email: string, after = 0): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
    const list = (await res.json()) as { messages: { ID: string; Created: string }[] }
    const latest = list.messages.find((m) => new Date(m.Created).getTime() >= after)
    if (latest) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${latest.ID}`)).json()) as { Text: string; HTML: string }
      const code = (msg.Text + msg.HTML).match(/>\s*(\d{6,8})\s*</)?.[1] ?? msg.Text.match(/\b(\d{6,8})\b/)?.[1]
      if (code) return code
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`ログインメールが届きませんでした: ${email}`)
}

/** メールで新規登録し、オンボーディングを飛ばしてホームまで進む */
export async function signUp(page: Page, email: string) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'メールではじめる' }).click()
  await page.getByLabel('メールアドレス').fill(email)
  const sentAt = Date.now() - 2000
  await page.getByRole('button', { name: 'コードを送る' }).click()
  await page.getByLabel('確認コード').fill(await mailCode(email, sentAt))
  await page.getByRole('button', { name: 'ログインする' }).click()
  await page.getByLabel('生年月').fill('1994-06')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'アカウントを作成' }).click()
  await expect(page).toHaveURL(/onboarding/)
  await page.getByRole('button', { name: 'スキップ' }).click()
  await page.getByRole('button', { name: 'スキップ' }).click()
  await page.getByRole('button', { name: 'はじめる' }).click()
  await expect(page).toHaveURL(/home/)
}

/** 認証アプリと同じ6桁の確認コード（TOTP / RFC 6238）を作る */
export function totp(secret: string, now = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)))
  const h = createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1] & 0xf
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(n % 1_000_000).padStart(6, '0')
}

/** 単色の PNG 画像（作品の表紙のアップロード用） */
export function png(width = 320, height = 200, rgb: [number, number, number] = [61, 107, 82]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3).map((_, i) => rgb[i % 3])])
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
