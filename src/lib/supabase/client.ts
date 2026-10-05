/**
 * Supabase クライアント（ブラウザ用の軽量版）。
 *
 * `@supabase/supabase-js` の createClient はストレージ・関数の SDK まで初回の JavaScript に含めてしまうため、
 * 認証（auth-js）・データ（postgrest-js）・リアルタイム（realtime-js）だけを組み立てる（18.1 初回 200KB 以下）。
 * 画像のアップロードと Edge Function の呼び出しは、それぞれの REST API を fetch で直接呼ぶ。
 * service_role の鍵はここに置かない（17.5）。公開してよい鍵（anon / publishable）と RLS で権限を強制する。
 */
import { GoTrueClient } from '@supabase/auth-js'
import { PostgrestClient } from '@supabase/postgrest-js'
import { RealtimeClient, type RealtimeChannel, type RealtimeChannelOptions } from '@supabase/realtime-js'

export function isSupabaseConfigured(): boolean {
  return !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY
}

class ZenoSupabase {
  readonly url: string
  readonly key: string
  readonly auth: GoTrueClient
  readonly realtime: RealtimeClient
  readonly rest: PostgrestClient
  private realtimeToken: string | undefined

  constructor(url: string, key: string) {
    const base = new URL(url.endsWith('/') ? url : `${url}/`)
    this.url = base.href.replace(/\/$/, '')
    this.key = key
    this.auth = new GoTrueClient({
      url: new URL('auth/v1', base).href,
      headers: { Authorization: `Bearer ${key}`, apikey: key },
      storageKey: `sb-${base.hostname.split('.')[0]}-auth-token`,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    })
    const ws = new URL('realtime/v1', base)
    ws.protocol = ws.protocol.replace('http', 'ws')
    this.realtime = new RealtimeClient(ws.href, {
      params: { apikey: key, eventsPerSecond: 5 },
      accessToken: async () => (await this.token()) ?? key,
    })
    this.rest = new PostgrestClient(new URL('rest/v1', base).href, { fetch: (input, init) => this.fetch(input, init) })
    // ログイン・トークン更新・ログアウトをリアルタイムの接続にも反映する（プライベートチャンネルの認可に使う）
    this.auth.onAuthStateChange((event, session) => {
      const token = session?.access_token
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') && token && token !== this.realtimeToken) {
        this.realtimeToken = token
        void this.realtime.setAuth(token)
      } else if (event === 'SIGNED_OUT') {
        this.realtimeToken = undefined
        void this.realtime.setAuth()
      }
    })
  }

  /** ログイン中ならそのアクセストークン */
  async token(): Promise<string | null> {
    const { data } = await this.auth.getSession()
    return data.session?.access_token ?? null
  }

  /** 公開鍵とログイン中のトークンを付けて fetch する */
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers)
    if (!headers.has('apikey')) headers.set('apikey', this.key)
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${(await this.token()) ?? this.key}`)
    return fetch(input, { ...init, headers })
  }

  from(relation: string) {
    return this.rest.from(relation)
  }

  rpc(fn: string, args?: Record<string, unknown>, options?: Parameters<PostgrestClient['rpc']>[2]) {
    return this.rest.rpc(fn, args, options)
  }

  channel(name: string, opts?: RealtimeChannelOptions): RealtimeChannel {
    return this.realtime.channel(name, opts)
  }

  removeChannel(channel: RealtimeChannel) {
    return this.realtime.removeChannel(channel)
  }

  /** Storage：画像を公開バケットに保存する（storage-js を使わず REST API を直接呼ぶ） */
  async upload(bucket: string, path: string, body: Blob, contentType: string): Promise<{ error: Error | null }> {
    const res = await this.fetch(`${this.url}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': contentType, 'Cache-Control': 'max-age=31536000', 'x-upsert': 'false' },
    })
    if (res.ok) return { error: null }
    const detail = await res.json().catch(() => ({}) as Record<string, string>)
    return { error: new Error(detail.message || detail.error || `HTTP ${res.status}`) }
  }

  publicUrl(bucket: string, path: string): string {
    return `${this.url}/storage/v1/object/public/${bucket}/${path}`
  }

  /** Edge Function を呼ぶ（functions-js を使わず fetch で直接呼ぶ） */
  async invoke<T = unknown>(name: string, body: unknown): Promise<{ data: T | null; error: Error | null }> {
    try {
      const token = await this.token()
      const res = await fetch(`${this.url}/functions/v1/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: this.key, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body ?? {}),
      })
      if (!res.ok) return { data: null, error: new Error(`HTTP ${res.status}`) }
      const type = res.headers.get('Content-Type') ?? ''
      return { data: (type.includes('json') ? await res.json() : await res.text()) as T, error: null }
    } catch (e) {
      return { data: null, error: e instanceof Error ? e : new Error(String(e)) }
    }
  }
}

export type SupabaseLite = ZenoSupabase

let client: ZenoSupabase | null = null

export function supabase(): ZenoSupabase {
  if (client) return client
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase が未設定です。VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を設定してください（docs/supabase-setup.md）')
  client = new ZenoSupabase(url, key)
  return client
}
