/**
 * Supabase 接続時の通し確認：登録 → 作品投稿 → 検索 → いいね → 問い合わせ → リアルタイムのやり取りと既読 → 運営の初期設定と利用制限。
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { png, signUp, totp } from './helpers'

const stamp = Date.now()
const creatorEmail = `creator${stamp}@example.com`
const buyerEmail = `buyer${stamp}@example.com`
const workTitle = `E2E作品${stamp % 100000}`
let workUrl = ''

let creator: { ctx: BrowserContext; page: Page }
let buyer: { ctx: BrowserContext; page: Page }

async function open(browser: Browser) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  return { ctx, page }
}

test.describe.serial('Supabase 接続', () => {
  test.beforeAll(async ({ browser }) => {
    creator = await open(browser)
    buyer = await open(browser)
  })
  test.afterAll(async () => {
    await creator.ctx.close()
    await buyer.ctx.close()
  })

  test('メールのコードで新規登録し、ホームに入る', async () => {
    await signUp(creator.page, creatorEmail)
    // 再読み込みしてもログインしたまま
    await creator.page.reload()
    await expect(creator.page).toHaveURL(/home/)
    await creator.page.goto('/me')
    await expect(creator.page.getByText(`creator${stamp}`.slice(0, 16)).first()).toBeVisible()
  })

  test('作品を投稿して公開すると、検索に出る', async () => {
    const page = creator.page
    await page.goto('/post')
    await page.getByRole('button', { name: /^LP/ }).click()
    await expect(page).toHaveURL(/\/post\/[0-9a-f-]+\?step=1/)
    await page.getByLabel('公開URL').fill('https://example.com/lp')
    await page.locator('input[type=file]').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: png() })
    await page.getByRole('button', { name: '決定' }).click()
    await expect(page.getByText('表紙')).toBeVisible()
    await page.getByRole('button', { name: '次へ：詳細' }).click()
    await page.getByLabel('タイトル').fill(workTitle)
    await page.getByRole('button', { name: '飲食' }).click()
    await page.getByRole('radio', { name: '自主制作' }).click()
    await page.getByLabel('タグを追加').fill('E2Eタグ')
    await page.getByRole('button', { name: '追加', exact: true }).click()
    await expect(page.getByText('必須項目はすべて入力済みです')).toBeVisible()
    await page.getByRole('button', { name: '次へ：プレビュー' }).click()
    await page.getByRole('button', { name: '公開する' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    workUrl = new URL(page.url()).pathname.replace('/post/', '/works/')

    await page.goto(`/search?q=${encodeURIComponent(workTitle)}`)
    await expect(page.getByRole('link', { name: new RegExp(workTitle) }).first()).toBeVisible()
  })

  test('別のユーザーが、いいねして問い合わせを送る', async () => {
    const page = buyer.page
    await signUp(page, buyerEmail)
    await page.goto(workUrl)
    await expect(page.getByRole('heading', { name: workTitle })).toBeVisible()
    const like = page.getByRole('button', { name: /^いいね、未選択/ }).first()
    await like.click()
    await expect(page.getByRole('button', { name: /^いいね、選択中、1件/ }).first()).toBeVisible()
    await page.getByRole('button', { name: 'この作品について問い合わせる' }).first().click()
    await expect(page).toHaveURL(/\/talk\/.+/)
    await page.getByLabel('メッセージ', { exact: true }).fill('はじめまして。制作のご相談です')
    await page.getByRole('button', { name: '送信' }).click()
    await expect(page.getByText('はじめまして。制作のご相談です').last()).toBeVisible()
    const later = page.getByRole('button', { name: 'あとで' })
    if (await later.isVisible().catch(() => false)) await later.click()
  })

  test('制作者に通知とトークが届き、返信がリアルタイムで相手に表示される', async () => {
    const page = creator.page
    await page.goto('/notifications')
    await expect(page.getByText(/いいね/).first()).toBeVisible()
    await expect(page.getByText(/問い合わせが届きました/).first()).toBeVisible()
    await page.goto('/talk')
    await page
      .getByRole('link', { name: new RegExp(`buyer${stamp}`.slice(0, 12)) })
      .first()
      .click()
    await expect(page.getByText('はじめまして。制作のご相談です').last()).toBeVisible()
    await page.getByLabel('メッセージ', { exact: true }).fill('ありがとうございます！詳しく教えてください')
    await page.getByRole('button', { name: '送信' }).click()
    const later = page.getByRole('button', { name: 'あとで' })
    if (await later.isVisible().catch(() => false)) await later.click()

    // 相手の画面は再読み込みせずに、新着と既読が表示される（Realtime）
    await expect(buyer.page.getByText('ありがとうございます！詳しく教えてください').last()).toBeVisible()
    await expect(buyer.page.getByText('既読').first()).toBeVisible()
  })

  test('最初のユーザーが運営オーナーになり、認証アプリで運営コンソールに入る', async () => {
    const page = creator.page
    await page.goto('/admin/login')
    await page.getByRole('button', { name: 'オーナーになる' }).click()
    const secret = (await page.locator('p.font-mono').textContent())!.trim()
    await page.getByLabel('確認コード（TOTP）').fill(totp(secret))
    await page.getByRole('button', { name: 'ログイン' }).click()
    await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible()
  })

  test('未ログインでも作品を検索して詳細を見られる', async ({ browser }) => {
    const guest = await open(browser)
    await guest.page.goto(`/search?q=${encodeURIComponent(workTitle)}`)
    await guest.page
      .getByRole('link', { name: new RegExp(workTitle) })
      .first()
      .click()
    await expect(guest.page.getByRole('heading', { name: workTitle })).toBeVisible()
    await guest.ctx.close()
  })

  test('プロフィールを編集すると、公開プロフィールに反映される', async () => {
    const page = creator.page
    await page.goto('/settings/profile')
    await page.getByLabel('表示名').fill('E2E制作者')
    await page.getByLabel('自己紹介').fill('LPとWebサイトを作っています')
    await page.getByRole('button', { name: '保存する' }).click()
    await expect(page.getByText('プロフィールを保存しました')).toBeVisible()
    await buyer.page.goto(workUrl)
    await expect(buyer.page.getByText('E2E制作者').filter({ visible: true }).first()).toBeVisible()
  })

  test('グループを作り、招待リンクから相手が参加してやり取りできる', async () => {
    const page = creator.page
    await page.goto('/talk/new-group')
    await page.getByRole('button', { name: /次へ/ }).click()
    await page.getByLabel('グループ名').fill('E2Eグループ')
    await page.getByRole('button', { name: '作成する' }).click()
    await expect(page).toHaveURL(/\/talk\/[0-9a-f-]+$/)
    const roomPath = new URL(page.url()).pathname
    await page.goto(`${roomPath}/settings`)
    await page.getByRole('button', { name: '招待リンク・QR' }).click()
    await page.getByRole('button', { name: 'リンクを作成' }).click()
    const link = (await page
      .getByText(/\/invite\//)
      .first()
      .textContent())!.trim()

    const b = buyer.page
    await b.goto(new URL(link).pathname)
    await b.getByRole('button', { name: 'グループに参加する' }).click()
    await expect(b).toHaveURL(new RegExp(roomPath))
    await b.getByLabel('メッセージ', { exact: true }).fill('グループに参加しました！')
    await b.getByRole('button', { name: '送信' }).click()
    const later = b.getByRole('button', { name: 'あとで' })
    if (await later.isVisible().catch(() => false)) await later.click()

    await page.goto(roomPath)
    await expect(page.getByText('グループに参加しました！').last()).toBeVisible()
    await expect(page.getByText(/さんが参加しました/).first()).toBeVisible()
  })

  test('一斉配信を送ると、公式アカウントのトークに名前入りで届く', async () => {
    const page = creator.page
    await page.goto('/admin/broadcasts/new')
    await page.getByLabel('管理用タイトル').fill('E2E配信')
    await page.getByLabel('テキスト').first().fill('{name}さん、E2Eのお知らせです')
    await page.getByLabel('Push の通知文').fill('E2Eのお知らせ')
    await page.getByRole('button', { name: /承認して配信する|配信する/ }).click()
    await page.getByRole('button', { name: '配信する', exact: true }).click()
    await expect(page).toHaveURL(/admin\/broadcasts$/)

    const b = buyer.page
    await b.goto('/talk')
    await b.getByRole('link', { name: /zenospace 公式/ }).click()
    await expect(b.getByText(/さん、E2Eのお知らせです/).last()).toBeVisible()
    await expect(b.getByText(/zenospace へようこそ/).first()).toBeVisible()
  })

  test('運営がチャット送信停止にすると、相手の入力欄が無効になる', async () => {
    const page = creator.page
    await page.goto('/admin/users')
    await page
      .getByRole('link', { name: new RegExp(`buyer${stamp}`.slice(0, 12)) })
      .first()
      .click()
    await page.getByRole('button', { name: 'チャット送信停止', exact: true }).click()
    await page.getByRole('button', { name: 'チャット送信停止を実行' }).click()
    await expect(page.getByText('チャット送信停止を実行しました')).toBeVisible()
    await page.goto('/admin/audit')
    await expect(page.getByText('restriction.create.chat_send').first()).toBeVisible()

    const b = buyer.page
    await b.reload()
    await b.goto('/talk')
    await b
      .getByRole('link', { name: /E2E制作者/ })
      .first()
      .click()
    await expect(b.getByRole('status').filter({ hasText: 'チャットの送信を' })).toBeVisible()
    await expect(b.getByLabel('メッセージ', { exact: true })).toHaveCount(0)
    // 公式アカウントから理由が届いている
    await b.goto('/talk')
    await b.getByRole('link', { name: /zenospace 公式/ }).click()
    await expect(b.getByText(/【チャット送信停止】/)).toBeVisible()
  })
})
