// Edge Functions 共通：service_role のクライアント（管理用の鍵はサーバー側だけに置く：17.5）
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** 呼び出したユーザーの JWT でクライアントを作る（RLS を効かせる） */
export function userClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  })
}

/** pg_cron / Database Webhook からの呼び出しだけを許す（service_role の Bearer） */
export function requireServiceRole(req: Request): Response | null {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/, '')
  if (token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return json({ error: 'forbidden' }, 403)
  return null
}

export const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } })
}
