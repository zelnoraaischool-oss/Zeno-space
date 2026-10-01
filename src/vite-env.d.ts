/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: 'mock' | 'supabase'
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_VAPID_PUBLIC_KEY?: string
  readonly VITE_R2_PUBLIC_BASE_URL?: string
  readonly VITE_TURNSTILE_SITE_KEY?: string
  readonly VITE_SENTRY_DSN?: string
  readonly VITE_MOCK_LATENCY?: string
  readonly VITE_MOCK_BOTS?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
