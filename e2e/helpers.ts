import { expect, type Page } from '@playwright/test'

export async function loginAs(page: Page, label: RegExp | string) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Googleではじめる' }).click()
  await page.getByRole('button', { name: label }).click()
  await expect(page).toHaveURL(/\/home|\/onboarding/)
}

export async function logout(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem('zenospace:session')
    sessionStorage.clear()
  })
}

export async function adminLogin(page: Page) {
  await page.goto('/admin/login')
  await page.getByLabel('確認コード（TOTP）').fill('123456')
  await page.getByRole('button', { name: 'ログイン' }).click()
  await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible()
}
