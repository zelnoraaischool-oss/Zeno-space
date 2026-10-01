-- =============================================================================
-- zenospace 0007: 定期処理（18.4）。pg_cron は UTC で設定するため、JST から9時間ずらす。
-- Edge Function の呼び出しは pg_net で行い、URL と鍵は Vault（vault.decrypted_secrets）から読む。
--   select vault.create_secret('https://<project>.supabase.co', 'project_url');
--   select vault.create_secret('<service_role_key>', 'service_role_key');
-- =============================================================================
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function private.invoke_edge_function(p_name text, p_body jsonb default '{}')
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/' || p_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := p_body,
    timeout_milliseconds := 30000
  )
$$;

-- AIニュース：毎日 7:00 JST に収集を始める（配信は 7:30。承認後配信モードは承認を待つ）= 22:00 UTC
select cron.schedule('ai-news-collect', '0 22 * * *', $$ select private.invoke_edge_function('ai-news', '{"step":"collect"}') $$);
-- 配信時刻の確認（承認済み・自動配信の送信）：毎分。Edge Function 側で設定時刻を見て送る
select cron.schedule('ai-news-deliver', '* * * * *', $$ select private.invoke_edge_function('ai-news', '{"step":"deliver"}') where exists (select 1 from public.news_digests where status in ('approved', 'pending') and date = (now() at time zone 'Asia/Tokyo')::date) $$);
-- 予約配信：1分ごと（Push は 500人ずつ）
select cron.schedule('broadcast-dispatch', '* * * * *', $$
  select private.deliver_due_broadcasts();
  select private.invoke_edge_function('broadcast-dispatch')
  where exists (select 1 from public.broadcasts where status = 'sent' and push_sent_at is null and canceled_at is null);
$$);
-- 期限切れの利用制限の解除：5分ごと
select cron.schedule('lift-expired-restrictions', '*/5 * * * *', $$ select private.lift_expired_restrictions() $$);
-- いいね通知のまとめ（1時間ごと）は private.notify の集約で実現。Push の送信をまとめて行う
select cron.schedule('push-digest-likes', '0 * * * *', $$ select private.invoke_edge_function('push-dispatch', '{"digest":"like"}') $$);
-- 保存した検索条件の新着通知：毎日 8:00 JST = 23:00 UTC
select cron.schedule('saved-search-notify', '0 23 * * *', $$ select private.invoke_edge_function('saved-search-notify') $$);
-- 集計値の補正と日次集計：毎日 3:00 JST = 18:00 UTC
select cron.schedule('reconcile-counts', '0 18 * * *', $$ select private.reconcile_counts() $$);
-- 保持期間を過ぎたデータの削除：毎日 3:30 JST = 18:30 UTC（R2 のファイルは Edge Function で削除）
select cron.schedule('retention', '30 18 * * *', $$ select private.cleanup_retention(); select private.invoke_edge_function('retention') $$);
-- 無料枠の使用量の記録：毎日 0:10 JST = 15:10 UTC
select cron.schedule('record-usage', '10 15 * * *', $$ select private.record_usage(); select private.invoke_edge_function('usage-monitor') $$);
-- DB のバックアップ（毎日 4:00 JST）は GitHub Actions（.github/workflows/backup.yml）で行う
