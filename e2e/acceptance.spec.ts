/**
 * 20.2 受け入れ基準の主要シナリオ（モック動作）。Supabase 接続後も同じシナリオで通す。
 */
import { expect, test } from '@playwright/test'
import { adminLogin, loginAs, logout } from './helpers'

test('新規登録：規約同意と生年月で登録し、オンボーディングを経てホームへ', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Googleではじめる' }).click()
  await page.getByLabel('メールアドレス').fill(`new${Date.now()}@example.com`)
  await page.getByLabel('表示名').fill('新しい人')
  await page.getByRole('button', { name: '続ける' }).click()
  await page.getByLabel('生年月').fill('1995-04')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'アカウントを作成' }).click()
  await expect(page).toHaveURL(/onboarding/)
  await page.getByRole('button', { name: 'スキップ' }).click()
  await page.getByRole('button', { name: 'スキップ' }).click()
  await page.getByRole('button', { name: 'はじめる' }).click()
  await expect(page).toHaveURL(/home/)
  await expect(page.getByText('今日のAIニュース').first()).toBeVisible()
})

test('1人1アカウント：ドットや + だけが違う Gmail では新しいアカウントを作らず連携を案内する', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'GitHubではじめる' }).click()
  await page.getByLabel('メールアドレス').fill('mio.d.e.s.i.g.n+second@gmail.com')
  await page.getByRole('button', { name: '続ける' }).click()
  await expect(page.getByText('1人1アカウントのため、新しいアカウントは作れません')).toBeVisible()
})

test('いいね：押すとすぐに色と数が変わる', async ({ page }) => {
  await loginAs(page, /くら/)
  await page.goto('/search')
  const like = page.getByRole('button', { name: /^いいね、未選択/ }).first()
  const label = (await like.getAttribute('aria-label'))!
  const n = Number(label.match(/(\d+)件/)![1])
  await like.click()
  await expect(page.getByRole('button', { name: `いいね、選択中、${n + 1}件` }).first()).toBeVisible()
})

test('問い合わせ：未ログインで押すとログインを促し、ログイン後に作品カード付きのトークが開く', async ({ page }) => {
  await page.goto('/search?q=灯')
  await page
    .getByRole('link', { name: /自家焙煎カフェ/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'この作品について問い合わせる' }).first().click()
  await page.getByRole('button', { name: 'Googleではじめる' }).click()
  await page.getByRole('button', { name: /たく/ }).click()
  await expect(page).toHaveURL(/\/talk\/.+inquiry=1/)
  await expect(page.getByRole('button', { name: '制作の相談' })).toBeVisible()
  await page.getByRole('button', { name: '制作の相談' }).click()
  await page.getByRole('button', { name: '送信' }).click()
  await expect(page.getByText('制作のご相談をしたくご連絡しました').last()).toBeVisible()
})

test('チャット送信停止：運営が実行すると入力欄が無効になり、理由と解除予定が表示される', async ({ page }) => {
  await loginAs(page, /くら/)
  await adminLogin(page)
  await page.goto('/admin/users')
  await page.getByRole('link', { name: /みお/ }).first().click()
  await page.getByRole('button', { name: 'チャット送信停止', exact: true }).click()
  await page.getByRole('button', { name: 'チャット送信停止を実行' }).click()
  await expect(page.getByText('チャット送信停止を実行しました')).toBeVisible()
  await page.goto('/admin/audit')
  await expect(page.getByText('restriction.create.chat_send')).toBeVisible()

  await logout(page)
  await loginAs(page, /みお/)
  await page.goto('/talk')
  await page.getByRole('link', { name: /AIスクール/ }).click()
  await expect(page.getByRole('status').filter({ hasText: 'チャットの送信を' })).toBeVisible()
  await expect(page.getByLabel('メッセージ', { exact: true })).toHaveCount(0)
})

test('一斉配信：全員宛てに配信すると公式アカウントのトークに届く', async ({ page }) => {
  await loginAs(page, /くら/)
  await adminLogin(page)
  await page.goto('/admin/broadcasts/new')
  await page.getByLabel('管理用タイトル').fill('E2E配信')
  await page.getByLabel('テキスト').first().fill('{name}さん、E2Eのお知らせです')
  await page.getByLabel('Push の通知文').fill('E2Eのお知らせ')
  await page.getByRole('button', { name: /承認して配信する|配信する/ }).click()
  await page.getByRole('button', { name: '配信する', exact: true }).click()
  await expect(page).toHaveURL(/admin\/broadcasts$/)

  await logout(page)
  await loginAs(page, /はな/)
  await page.goto('/talk')
  await page.getByRole('link', { name: /zenospace 公式/ }).click()
  await expect(page.getByText('はなさん、E2Eのお知らせです')).toBeVisible()
})

test('既読：送ったメッセージに相手が開くと既読が付く', async ({ page }) => {
  await loginAs(page, /くら/)
  await page.goto('/talk')
  await page.getByRole('link', { name: /AIスクール/ }).click()
  await page.getByLabel('メッセージ', { exact: true }).fill('既読テスト')
  await page.getByRole('button', { name: '送信' }).click()
  await page.getByRole('button', { name: 'あとで' }).click()
  await logout(page)
  await loginAs(page, /みお/)
  await page.goto('/talk')
  await page.getByRole('link', { name: /AIスクール/ }).click()
  await expect(page.getByText('既読テスト')).toBeVisible()
  // 既読が端末内のモックDBに保存されるまで待つ
  await expect
    .poll(() =>
      page.evaluate(() => {
        const d = JSON.parse(localStorage.getItem('zenospace:mockdb:v1') ?? '{}')
        const room = d.rooms?.find((r: { kind: string }) => r.kind === 'group')
        const mio = d.profiles?.find((p: { handle: string }) => p.handle === 'mio_design')
        const mem = d.roomMembers?.find((m: { roomId: string; userId: string }) => m.roomId === room?.id && m.userId === mio?.id)
        const last = d.messages?.filter((m: { roomId: string }) => m.roomId === room?.id).at(-1)
        return !!mem && !!last && mem.lastReadAt >= last.createdAt
      }),
    )
    .toBe(true)
  await logout(page)
  await loginAs(page, /くら/)
  await page.goto('/talk')
  await page.getByRole('link', { name: /AIスクール/ }).click()
  await expect(page.getByText('既読 1').last()).toBeVisible()
})
