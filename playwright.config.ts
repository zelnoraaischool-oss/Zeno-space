import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'

// 18.6 画面の通し（登録、送信、いいね、問い合わせ、利用制限、一斉配信）。モックDBで動かす
// 事前インストール済みの Chromium があれば使う（Claude Code on the web など）
const localChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync(localChromium) ? localChromium : undefined)

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions: executablePath ? { executablePath } : undefined } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    env: { VITE_DATA_SOURCE: 'mock', VITE_MOCK_BOTS: 'false', VITE_MOCK_LATENCY: '0' },
  },
})
