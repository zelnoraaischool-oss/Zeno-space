import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'

/**
 * Supabase に接続した状態の通し確認（ローカルの `supabase start` を使う）。
 *   npx supabase start && npm run test:e2e:supabase
 * 本物の認証（メールOTP）・RLS・RPC・Realtime・Storage を通す。
 */
const localChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync(localChromium) ? localChromium : undefined)

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'
// supabase start が表示する公開してよい鍵（ローカル専用の固定値）
const SUPABASE_KEY = process.env.E2E_SUPABASE_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'

export default defineConfig({
  testDir: './e2e-supabase',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5175',
    trace: 'retain-on-failure',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 1440, height: 900 },
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  webServer: {
    command: 'npx vite --port 5175 --strictPort',
    url: 'http://localhost:5175',
    reuseExistingServer: false,
    env: { VITE_DATA_SOURCE: 'supabase', VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_ANON_KEY: SUPABASE_KEY },
  },
})
