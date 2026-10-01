/**
 * Supabase クライアント（VITE_DATA_SOURCE=supabase のときに使う）。
 * service_role の鍵はここに置かない（17.5）。anon キーと RLS で権限を強制する。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function isSupabaseConfigured(): boolean {
  return !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY
}

export function supabase(): SupabaseClient {
  if (client) return client
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase が未設定です。.env の VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を設定してください（docs/supabase-setup.md）')
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    realtime: { params: { eventsPerSecond: 5 } },
  })
  return client
}

/**
 * Realtime：トークを開いている間だけプライベートチャンネル `room:{id}` を購読する。
 * アプリが裏に回ったら切断して Web Push に切り替え、同時接続数を節約する（6章・17.5）。
 */
export function subscribeRoom(roomId: string, onChange: (payload: unknown) => void): () => void {
  const ch = supabase()
    .channel(`room:${roomId}`, { config: { private: true } })
    .on('broadcast', { event: '*' }, (p) => onChange(p))
    .subscribe()
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') void ch.unsubscribe()
    else ch.subscribe()
  }
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
    void supabase().removeChannel(ch)
  }
}
