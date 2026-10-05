/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

/**
 * Supabase の接続先。Vercel の Supabase 連携が入れる変数名（NEXT_PUBLIC_SUPABASE_* / SUPABASE_*）でも動くように読み替える。
 * ブラウザに渡すのは URL と公開してよい鍵（anon / publishable）だけ。service_role や secret の鍵は読まない（17.5）。
 */
function supabaseEnv(env: Record<string, string>) {
  const url = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || ''
  const key =
    env.VITE_SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.SUPABASE_PUBLISHABLE_KEY ||
    ''
  return { url, key }
}

// 15.4 PWA: マニフェスト・キャッシュ戦略
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env } as Record<string, string>
  const sb = supabaseEnv(env)
  // 接続先があれば Supabase、なければ端末内のモック。テストは常にモック
  const dataSource = mode === 'test' ? 'mock' : env.VITE_DATA_SOURCE || (sb.url && sb.key ? 'supabase' : 'mock')
  return {
    define: {
      'import.meta.env.VITE_DATA_SOURCE': JSON.stringify(dataSource),
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(sb.url),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(sb.key),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icons/*.svg', 'icons/*.png'],
        manifest: {
          id: '/',
          name: 'zenospace',
          short_name: 'zenospace',
          description: 'つくったものが、会話のはじまりになる。',
          lang: 'ja',
          start_url: '/home',
          display: 'standalone',
          theme_color: '#E7E6E2',
          background_color: '#E7E6E2',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
          shortcuts: [
            { name: 'トーク', url: '/talk' },
            { name: '作品を投稿', url: '/post' },
          ],
          share_target: {
            action: '/share-target',
            method: 'GET',
            params: { title: 'title', text: 'text', url: 'url' },
          },
        },
        workbox: {
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          // ログインしたユーザーのデータ（Supabase の API）は Service Worker でキャッシュしない（共用端末での取り違えを防ぐ）
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.destination === 'image',
              handler: 'StaleWhileRevalidate',
              options: { cacheName: 'images', expiration: { maxEntries: 200 } },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: [
        // データ層の実装はビルド時に1つだけ選ぶ（使わない方を本番の JavaScript に含めない）
        {
          find: '@impl',
          replacement: fileURLToPath(new URL(dataSource === 'supabase' ? './src/lib/api/supabase/index.ts' : './src/lib/api/mock/index.ts', import.meta.url)),
        },
        { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      ],
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      env: { VITE_MOCK_LATENCY: '0', VITE_MOCK_BOTS: 'false' },
      exclude: ['node_modules', 'dist', 'e2e'],
    },
  }
})
