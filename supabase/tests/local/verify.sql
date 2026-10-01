-- =============================================================================
-- ローカル検証：1人1アカウント、RLS、制限の強制、監査ログ（要件 20.2 の一部を SQL で確かめる）
-- 失敗すると例外で止まる。
-- =============================================================================
\set ON_ERROR_STOP on
\o /dev/null
set client_min_messages = warning;

-- テスト用のヘルパー：ロールと JWT を切り替える
create or replace function pg_temp.login(p_user uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end $$;

-- 公式アカウント・マスタ・設定は seed.sql で投入済み

-- ---- 1人1アカウント（ZS-ONE-01/02）----
insert into auth.users (id, email, raw_app_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'Alice.Smith+zen@gmail.com', '{"provider":"google"}'),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.com', '{"provider":"google"}'),
  ('33333333-3333-4333-8333-333333333333', 'carol@example.com', '{"provider":"github"}'),
  ('44444444-4444-4444-8444-444444444444', 'kura@example.com', '{"provider":"google"}');
do $$ begin
  assert (select count(*) from public.profiles) = 5, 'プロフィールが作られていない';
  assert (select count(*) from public.categories) = 10, 'カテゴリのマスタがない';
  assert (select count(*) from public.rooms where kind = 'official') = 4, '公式トークが自動で追加されていない';
  assert private.normalize_email('Alice.Smith+zen@gmail.com') = 'alicesmith@gmail.com', 'メールの正規化が違う';
end $$;
do $$ begin
  begin
    insert into auth.users (email, raw_app_meta_data) values ('alicesmith@googlemail.com', '{"provider":"github"}');
    raise exception 'ドットや + だけが違う Gmail で2つ目のアカウントが作れてしまった';
  exception when raise_exception then
    if sqlerrm <> 'duplicate_account' then raise; end if;
  end;
end $$;

-- 運営オーナー（kura）
insert into public.admin_members (user_id, role, totp_enrolled) values ('44444444-4444-4444-8444-444444444444', 'owner', true);
update public.profiles set onboarded = true;

-- ---- グループを作って送受信（alice がオーナー、bob が参加、carol は不参加）----
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select public.create_group('テスト', array['22222222-2222-4222-8222-222222222222']::uuid[]) as room \gset
select (public.send_message(:'room'::uuid, 'こんにちは', gen_random_uuid())).id as msg \gset
select set_config('test.room', :'room', false);
select pg_temp.logout();

select pg_temp.login('22222222-2222-4222-8222-222222222222');
do $$ begin
  assert (select count(*) from public.messages where body = 'こんにちは') = 1, '参加者がメッセージを読めない';
end $$;
select public.mark_read(:'room'::uuid);
select pg_temp.logout();

select pg_temp.login('33333333-3333-4333-8333-333333333333');
do $$ begin
  assert (select count(*) from public.messages where body = 'こんにちは') = 0, '参加していない人がメッセージを読めてしまう';
  assert (select count(*) from public.rooms where kind = 'group') = 0, '参加していない人がルームを見られてしまう';
end $$;
-- 参加していないルームへの直接 insert は RLS で拒否
do $$ begin
  begin
    insert into public.messages (room_id, sender_id, body, client_id)
    values (current_setting('test.room')::uuid, '33333333-3333-4333-8333-333333333333', '乱入', gen_random_uuid());
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.logout();
do $$ begin
  assert (select count(*) from public.messages where body = '乱入') = 0, '参加していないルームに書き込めてしまった';
end $$;

-- 既読 N：bob が既読
do $$ begin
  assert (select count(*) from public.room_members m join public.messages msg on msg.room_id = m.room_id
          where msg.body = 'こんにちは' and m.user_id <> msg.sender_id and m.last_read_at >= msg.created_at) = 1, '既読が数えられていない';
  assert (select count(*) from public.notifications where user_id = '22222222-2222-4222-8222-222222222222' and kind = 'message') = 1, '新着メッセージの通知がない';
end $$;

-- ---- 利用制限（20.2「チャット送信停止」）----
-- aal1（TOTP 未済み）の運営は実行できない
select pg_temp.login('44444444-4444-4444-8444-444444444444', 'aal1');
do $$ begin
  begin
    perform public.admin_restrict(array['11111111-1111-4111-8111-111111111111']::uuid[], 'chat_send', now() + interval '24 hours', 'スパム');
    raise exception 'TOTP 未済みで利用制限を実行できてしまった';
  exception when raise_exception then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end $$;
select pg_temp.logout();

select pg_temp.login('44444444-4444-4444-8444-444444444444', 'aal2');
select public.admin_restrict(array['11111111-1111-4111-8111-111111111111']::uuid[], 'chat_send', now() + interval '24 hours', 'スパム', '', '調査中');
select pg_temp.logout();

select pg_temp.login('11111111-1111-4111-8111-111111111111');
-- RPC 経由は拒否
do $$ begin
  begin
    perform public.send_message((select id from public.rooms where kind = 'group'), '送れる？', gen_random_uuid());
    raise exception '制限中なのに送信できてしまった';
  exception when raise_exception then
    if sqlerrm <> 'restricted' then raise; end if;
  end;
end $$;
-- API へ直接 insert しても拒否（ZS-ADM-03）
do $$ begin
  begin
    insert into public.messages (room_id, sender_id, body, client_id) values ((select id from public.rooms where kind = 'group'), '11111111-1111-4111-8111-111111111111', '直接', gen_random_uuid());
    raise exception '制限中なのに直接 insert できてしまった';
  exception when insufficient_privilege then null;
  end;
end $$;
-- 公式アカウントとのトークには送れる
select public.send_message(private.official_room('11111111-1111-4111-8111-111111111111'), '異議があります', gen_random_uuid());
-- 本人は自分の制限を見られるが、社内メモは見えない（my_restrictions ビュー）
do $$ begin
  assert (select count(*) from public.my_restrictions) = 1, '本人が制限を確認できない';
end $$;
select pg_temp.logout();

do $$ begin
  assert (select count(*) from public.support_threads) = 1, 'サポート受信箱にスレッドが作られていない';
  assert exists (select 1 from public.messages m join public.rooms r on r.id = m.room_id
                 where r.kind = 'official' and m.body like '【チャット送信停止】%'), '公式アカウントから制限の通知が届いていない';
  assert exists (select 1 from public.audit_logs where action = 'restriction.create.chat_send'), '監査ログに残っていない';
end $$;

-- 監査ログは誰も書き換えられない
select pg_temp.login('44444444-4444-4444-8444-444444444444', 'aal2');
do $$ begin
  begin
    delete from public.audit_logs;
    raise exception '監査ログを削除できてしまった';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.logout();

-- 期限が来たら自動で解除（ZS-ADM-04）
update public.restrictions set ends_at = now() - interval '1 minute' where user_id = '11111111-1111-4111-8111-111111111111';
do $$ begin
  assert private.lift_expired_restrictions() = 1, '期限切れの制限が解除されない';
  assert not private.has_restriction('11111111-1111-4111-8111-111111111111', array['chat_send']), '解除後も制限が残っている';
end $$;
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select public.send_message((select id from public.rooms where kind = 'group'), '解除されました', gen_random_uuid());
select pg_temp.logout();

-- ---- メッセージリクエスト（ZS-SOC-03）とブロック ----
select pg_temp.login('33333333-3333-4333-8333-333333333333');
select public.open_direct('22222222-2222-4222-8222-222222222222') as dm \gset
select public.send_message(:'dm'::uuid, 'はじめまして', gen_random_uuid());
select pg_temp.logout();
do $$ begin
  assert (select state from public.room_members m join public.rooms r on r.id = m.room_id where r.kind = 'direct' and m.user_id = '22222222-2222-4222-8222-222222222222') = 'request', '友だちでない相手からのメッセージがリクエストに入っていない';
  assert exists (select 1 from public.notifications where user_id = '22222222-2222-4222-8222-222222222222' and kind = 'request'), 'リクエストの通知がない';
end $$;
select pg_temp.login('22222222-2222-4222-8222-222222222222');
insert into public.blocks (blocker_id, blocked_id) values ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');
select pg_temp.logout();
select pg_temp.login('33333333-3333-4333-8333-333333333333');
select public.send_message(:'dm'::uuid, 'ブロック後', gen_random_uuid());
select pg_temp.logout();
select pg_temp.login('22222222-2222-4222-8222-222222222222');
do $$ begin
  assert (select count(*) from public.messages where body = 'ブロック後') = 0, 'ブロックした相手からのメッセージが届いてしまう';
  assert (select count(*) from public.profiles where id = '33333333-3333-4333-8333-333333333333') = 1, 'ブロックした側から相手が見えない（見えてよい）';
end $$;
select pg_temp.logout();
select pg_temp.login('33333333-3333-4333-8333-333333333333');
do $$ begin
  assert (select count(*) from public.profiles where id = '22222222-2222-4222-8222-222222222222') = 0, 'ブロックされた側から相手のプロフィールが見えてしまう';
end $$;
select pg_temp.logout();

-- ---- 作品：下書きは本人だけ、公開の必須チェック、いいね数 ----
select pg_temp.login('11111111-1111-4111-8111-111111111111');
insert into public.works (owner_id, type, title) values ('11111111-1111-4111-8111-111111111111', 'lp', 'テストLP') returning id as work \gset
do $$ begin
  begin
    update public.works set visibility = 'public' where title = 'テストLP';
    raise exception '必須項目なしで公開できてしまった';
  exception when raise_exception then
    if sqlerrm <> 'work_incomplete' then raise; end if;
  end;
end $$;
update public.works set category_id = (select id from public.categories limit 1), production_type = 'personal', url = 'https://example.com', visibility = 'public' where id = :'work';
select pg_temp.logout();
select pg_temp.login('22222222-2222-4222-8222-222222222222');
insert into public.likes (user_id, work_id) values ('22222222-2222-4222-8222-222222222222', :'work');
select public.record_view(:'work'::uuid);
select pg_temp.logout();
do $$ begin
  assert (select like_count from public.works where title = 'テストLP') = 1, 'いいね数が更新されていない';
  assert (select view_count from public.works where title = 'テストLP') = 1, '閲覧数が更新されていない';
  assert exists (select 1 from public.notifications where user_id = '11111111-1111-4111-8111-111111111111' and kind = 'like'), 'いいねの通知がない';
end $$;
-- 未ログイン（anon）でも公開作品と公開プロフィールは見られる
set role anon;
do $$ begin
  assert (select count(*) from public.works where title = 'テストLP') = 1, '未ログインで公開作品が見えない';
  assert (select count(*) from public.messages) = 0, '未ログインでメッセージが見えてしまう';
end $$;
reset role;

-- ---- 問い合わせ（6.4）----
select pg_temp.login('22222222-2222-4222-8222-222222222222');
select public.open_inquiry(:'work'::uuid) as inq \gset
select pg_temp.logout();
select pg_temp.login('11111111-1111-4111-8111-111111111111');
select public.send_message(:'inq'::uuid, 'お問い合わせありがとうございます', gen_random_uuid());
select pg_temp.logout();
do $$ begin
  assert (select first_reply_at is not null from public.inquiries), '初回返信の時刻が記録されていない';
  assert (select kind from public.messages where room_id = (select room_id from public.inquiries) order by id limit 1) = 'work', '問い合わせの先頭に作品カードがない';
end $$;

-- ---- Realtime の認可：参加者だけが room:{id} を購読できる ----
select set_config('realtime.topic', 'room:' || (select id from public.rooms where kind = 'group'), false);
select pg_temp.login('33333333-3333-4333-8333-333333333333');
do $$ begin
  assert (select count(*) from realtime.messages where topic = realtime.topic()) = 0, '参加していない人がチャンネルを購読できてしまう';
end $$;
select pg_temp.logout();
select pg_temp.login('22222222-2222-4222-8222-222222222222');
do $$ begin
  assert (select count(*) from realtime.messages where topic = realtime.topic()) > 0, '参加者がチャンネルを購読できない';
end $$;
select pg_temp.logout();

-- ---- 一斉配信（20.2「一斉配信」：本文は1件だけ、宛先の数だけ行は増えない）----
select pg_temp.login('44444444-4444-4444-8444-444444444444', 'aal2');
insert into public.broadcasts (title, bubbles, push_text) values ('お知らせ', '[{"type":"text","text":"{name}さん、こんにちは"}]', 'お知らせ') returning id as bid \gset
select set_config('test.bid', :'bid', false);
select public.admin_send_broadcast(:'bid'::uuid);
update public.banners set title = title; -- no-op
insert into public.banners (title, starts_at, ends_at) values ('メンテ', now(), now() + interval '1 day');
select pg_temp.logout();
do $$ begin
  assert (select count(*) from public.broadcasts where title = 'お知らせ') = 1, '配信本文が複製されている';
  assert (select count(*) from public.broadcast_recipients br join public.broadcasts b on b.id = br.broadcast_id where b.title = 'お知らせ') = 0, '全員配信で宛先の行が増えている';
  assert (select target_count from public.broadcasts where title = 'お知らせ') = 4, '配信対象数が違う';
  assert exists (select 1 from public.audit_logs where action = 'banners.insert'), 'マスタ変更が監査ログに残っていない';
end $$;
select pg_temp.login('22222222-2222-4222-8222-222222222222');
do $$ begin
  assert (select count(*) from public.official_feed() f where f.broadcast_id = current_setting('test.bid')::uuid) = 1, '公式トークに配信が表示されない';
  assert (select count(*) from public.broadcasts) = 0, '一般ユーザーが broadcasts テーブルを直接読めてしまう';
end $$;
select pg_temp.logout();
-- 取り消すと全員の画面から消える
select pg_temp.login('44444444-4444-4444-8444-444444444444', 'aal2');
select public.admin_cancel_broadcast(:'bid'::uuid);
select pg_temp.logout();
select pg_temp.login('22222222-2222-4222-8222-222222222222');
do $$ begin
  assert (select count(*) from public.official_feed() f where f.broadcast_id = current_setting('test.bid')::uuid) = 0, '取り消した配信が残っている';
end $$;
select pg_temp.logout();

\echo 'verify.sql: すべての検証に合格しました'
