-- =============================================================================
-- zenospace 0004: サーバー関数（RPC）とトリガー
-- 画面を経由しない操作でも、ここで制限・ブロック・レート制限を強制する。
-- =============================================================================

-- 公式アカウントの固定ID（src/lib/constants.ts の OFFICIAL_USER_ID と同じ）
create or replace function private.official_id()
returns uuid
language sql
immutable
as $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;

create or replace function private.setting(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select value from public.app_settings where key = p_key $$;

-- 監査ログへの追記（ZS-ADM-25）。audit_logs への書き込みはこの関数だけ
create or replace function private.audit(p_actor uuid, p_action text, p_target_type text, p_target_id text, p_before jsonb, p_after jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (actor_id, action, target_type, target_id, before, after)
  values (p_actor, p_action, p_target_type, p_target_id, p_before, p_after)
$$;

-- 通知を作る。同じ種類・同じ遷移先の未読（1時間以内）はまとめる（8.3）
create or replace function private.notify(p_user uuid, p_kind text, p_actor uuid, p_target text, p_text text, p_group boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_id uuid;
begin
  if p_user = private.official_id() then
    return;
  end if;
  select coalesce((notify ->> p_kind)::boolean, true) into v_enabled from public.user_settings where user_id = p_user;
  if p_kind <> 'important' and v_enabled is false then
    return;
  end if;
  if p_group then
    select id into v_id from public.notifications
    where user_id = p_user and kind = p_kind and target = p_target and read_at is null and created_at > now() - interval '1 hour'
    order by created_at desc limit 1;
    if v_id is not null then
      update public.notifications
      set grouped_count = grouped_count + 1, text = replace(p_text, '{n}', (grouped_count + 1)::text), created_at = now(), actor_id = coalesce(p_actor, actor_id)
      where id = v_id;
      return;
    end if;
  end if;
  -- Web Push は notifications への insert を Database Webhook で受けた Edge Function `push-dispatch` が送る
  insert into public.notifications (user_id, kind, actor_id, target, text)
  values (p_user, p_kind, p_actor, p_target, replace(p_text, '{n}', '1'));
end;
$$;

create or replace function private.official_room(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.room_id from public.room_members m join public.rooms r on r.id = m.room_id
  where m.user_id = p_user and r.kind = 'official' limit 1
$$;

-- 公式アカウントから本人へ個別に送る（制限の通知・解除・サポート返信）
create or replace function private.official_say(p_user uuid, p_text text, p_important boolean default true, p_admin_name text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid := private.official_room(p_user);
begin
  if v_room is null then
    return;
  end if;
  insert into public.messages (room_id, sender_id, kind, body, meta, client_id)
  values (v_room, private.official_id(), 'text', p_text, jsonb_build_object('fromAdmin', jsonb_build_object('name', p_admin_name)), gen_random_uuid());
  update public.rooms set last_message_at = now(), last_message_preview = left(p_text, 80) where id = v_room;
  if p_important then
    perform private.notify(p_user, 'important', private.official_id(), '/talk/' || v_room, left(p_text, 60));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 新規登録（auth.users への insert で動く）：1人1アカウント制御（5.2）
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := private.normalize_email(new.email);
  v_email_hash text := private.hash_identity(private.normalize_email(new.email));
  v_provider text := coalesce(new.raw_app_meta_data ->> 'provider', 'email');
  v_provider_id text := coalesce(new.raw_user_meta_data ->> 'provider_id', new.raw_user_meta_data ->> 'sub');
  v_handle text;
  v_name text := left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, 'user'), '@', 1)), 20);
  v_room uuid;
begin
  if new.id = private.official_id() then
    return new;
  end if;
  -- 永久停止された識別子では再登録できない
  if exists (select 1 from private.banned_identities b where b.value_hash = v_email_hash) then
    raise exception 'banned_identity' using errcode = 'P0001', hint = 'このメールアドレスでは登録できません';
  end if;
  -- ZS-ONE-01/02 正規化したメールで重複判定。既存アカウントがあれば作らない（クライアントは連携を案内）
  if exists (select 1 from private.identity_keys k where k.kind = 'email' and k.value_hash = v_email_hash) then
    raise exception 'duplicate_account' using errcode = 'P0001', hint = 'このメールアドレスのアカウントはすでにあります';
  end if;
  -- 招待制モード（ZS-ONE-05）：raw_user_meta_data.invite_code を確かめる
  if coalesce((private.setting('invite_only'))::boolean, false) then
    if not exists (
      select 1 from public.invite_codes c
      where c.code = new.raw_user_meta_data ->> 'invite_code' and c.used_by is null and (c.expires_at is null or c.expires_at > now())
    ) then
      raise exception 'invite_required' using errcode = 'P0001', hint = '招待コードが必要です';
    end if;
  end if;

  v_handle := left(regexp_replace(split_part(v_email, '@', 1), '[^a-zA-Z0-9_]', '', 'g'), 16);
  if char_length(v_handle) < 4 then
    v_handle := 'user' || v_handle;
  end if;
  while exists (select 1 from public.profiles p where lower(p.handle) = lower(v_handle)) loop
    v_handle := left(v_handle, 14) || (10 + floor(random() * 90))::int::text;
  end loop;

  insert into public.profiles (id, handle, display_name)
  values (new.id, v_handle, case when char_length(btrim(v_name)) = 0 then v_handle else v_name end);
  insert into public.user_settings (user_id) values (new.id);
  insert into private.identity_keys (user_id, kind, value_hash) values (new.id, 'email', v_email_hash);
  if v_provider in ('google', 'github') and v_provider_id is not null then
    insert into private.identity_keys (user_id, kind, value_hash)
    values (new.id, v_provider, private.hash_identity(v_provider || ':' || v_provider_id))
    on conflict do nothing;
  end if;
  if new.raw_user_meta_data ? 'invite_code' then
    update public.invite_codes set used_by = new.id, used_at = now() where code = new.raw_user_meta_data ->> 'invite_code' and used_by is null;
  end if;

  -- ZS-OFC-01 公式アカウントをトークリストへ自動で追加する
  insert into public.rooms (kind, name, owner_id, member_count, last_message_preview)
  values ('official', 'zenospace 公式', private.official_id(), 2, 'zenospace へようこそ！')
  returning id into v_room;
  insert into public.room_members (room_id, user_id, role, last_read_at) values (v_room, new.id, 'member', 'epoch'), (v_room, private.official_id(), 'owner', now());
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

-- 別のログイン手段を連携したとき（auth.identities）にも識別子を登録する（ZS-AUTH-03）
create or replace function private.handle_new_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider in ('google', 'github') then
    insert into private.identity_keys (user_id, kind, value_hash)
    values (new.user_id, new.provider, private.hash_identity(new.provider || ':' || new.provider_id))
    on conflict (kind, value_hash) do nothing;
  end if;
  return new;
end;
$$;
create trigger on_auth_identity_created after insert on auth.identities for each row execute function private.handle_new_identity();

-- 登録の仕上げ：規約同意（ZS-AUTH-06）と年齢確認（ZS-AUTH-07。Q-02 仮置き18歳以上）
create or replace function public.complete_signup(p_birth_ym text, p_terms_version text, p_privacy_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_age int;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;
  if p_birth_ym !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid_birth_ym';
  end if;
  v_age := extract(year from age(now(), to_date(p_birth_ym || '-01', 'YYYY-MM-DD')))::int;
  if v_age < 18 then
    raise exception 'under_age' using hint = 'zenospace は18歳以上の方を対象としています';
  end if;
  update public.profiles set birth_ym = p_birth_ym where id = auth.uid();
  insert into public.consents (user_id, doc, version) values (auth.uid(), 'terms', p_terms_version), (auth.uid(), 'privacy', p_privacy_version)
  on conflict do nothing;
end;
$$;

-- ZS-ONE-03 端末の識別情報（端末側でハッシュ化した値）を記録し、重複の疑いを作る
create or replace function public.record_device(p_device_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_users uuid[];
begin
  if auth.uid() is null or char_length(p_device_hash) < 16 then
    return;
  end if;
  insert into private.device_hashes (user_id, device_hash) values (auth.uid(), p_device_hash)
  on conflict (user_id, device_hash) do update set last_seen_at = now();
  update public.profiles set last_login_at = now() where id = auth.uid();
  select array_agg(distinct user_id) into v_users from private.device_hashes where device_hash = p_device_hash;
  if cardinality(v_users) > 1 then
    insert into public.dup_suspicions (device_hash, user_ids) values (p_device_hash, v_users)
    on conflict (device_hash) do update set user_ids = excluded.user_ids, status = case when public.dup_suspicions.status = 'ok' then 'ok' else 'open' end;
  end if;
end;
$$;

-- ZS-AUTH-04 ユーザーIDの変更（30日に1回）
create or replace function public.change_handle(p_handle text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed timestamptz;
begin
  if p_handle !~ '^[A-Za-z0-9_]{4,20}$' then
    raise exception 'invalid_handle';
  end if;
  select handle_changed_at into v_changed from public.profiles where id = auth.uid();
  if v_changed is not null and v_changed > now() - interval '30 days' then
    raise exception 'handle_change_too_soon' using hint = 'ユーザーIDの変更は30日に1回までです';
  end if;
  update public.profiles set handle = p_handle, handle_changed_at = now() where id = auth.uid();
exception when unique_violation then
  raise exception 'handle_taken' using hint = 'このユーザーIDはすでに使われています';
end;
$$;

-- ZS-AUTH-09 退会申請（30日は復元可能。30日後に cleanup_retention() が個人情報を削除）
create or replace function public.request_account_deletion()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set status = 'leaving', deleted_at = now() where id = auth.uid() and status = 'active'
$$;

-- ---------------------------------------------------------------------------
-- チャット
-- ---------------------------------------------------------------------------
-- 6章 送信。制限・ブロック・レート制限・文字数を確かめ、通知を作る
create or replace function public.send_message(
  p_room uuid,
  p_body text,
  p_client_id uuid,
  p_kind text default 'text',
  p_reply_to bigint default null,
  p_meta jsonb default '{}'
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_room public.rooms;
  v_member public.room_members;
  v_msg public.messages;
  v_rate int;
  v_preview text;
  v_sender_name text;
  r record;
begin
  if v_me is null then
    raise exception 'unauthenticated';
  end if;
  -- client_id 一意：オフライン再送の二重登録を防ぐ
  select * into v_msg from public.messages where client_id = p_client_id;
  if found then
    return v_msg;
  end if;
  select * into v_room from public.rooms where id = p_room;
  select * into v_member from public.room_members where room_id = p_room and user_id = v_me;
  if v_room.id is null or v_member.user_id is null or v_member.state = 'left' then
    raise exception 'not_found';
  end if;
  if not private.is_active_user(v_me) then
    raise exception 'restricted' using hint = 'このアカウントは利用できません';
  end if;
  if v_room.kind <> 'official' and private.has_restriction(v_me, array['chat_send', 'chat_all']) then
    raise exception 'restricted' using hint = '現在、チャットの送信は制限されています';
  end if;
  if p_kind not in ('text', 'image', 'file', 'work', 'link') then
    raise exception 'invalid_kind';
  end if;
  if p_kind = 'text' and char_length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'empty_message';
  end if;
  if p_kind = 'image' and coalesce((private.setting('heavy_features_paused'))::boolean, false) then
    raise exception 'paused' using hint = '現在、画像の送信を一時停止しています';
  end if;
  if v_room.kind in ('direct', 'inquiry') and exists (
    select 1 from public.room_members m where m.room_id = p_room and m.user_id <> v_me and private.blocked(v_me, m.user_id)
  ) then
    raise exception 'blocked';
  end if;
  -- ZS-SAFE-02 1分に30通（設定値）を超える送信を止める
  select count(*) into v_rate from public.messages where sender_id = v_me and created_at > now() - interval '1 minute';
  if v_rate >= coalesce((private.setting('send_rate_per_minute'))::int, 30) then
    raise exception 'rate_limited' using hint = '少し時間をおいてから送信してください';
  end if;

  insert into public.messages (room_id, sender_id, kind, body, reply_to_id, meta, client_id)
  values (p_room, v_me, p_kind, coalesce(p_body, ''), p_reply_to, coalesce(p_meta, '{}'), p_client_id)
  returning * into v_msg;

  v_preview := case p_kind when 'image' then '写真を送信しました' when 'file' then 'ファイルを送信しました' when 'work' then '作品を共有しました' else left(p_body, 80) end;
  update public.rooms set last_message_at = v_msg.created_at, last_message_preview = v_preview where id = p_room;
  -- 返信したらリクエストを承認したことにする。自分の既読も進める
  update public.room_members set last_read_at = v_msg.created_at, hidden_at = null, state = 'active' where room_id = p_room and user_id = v_me;

  if v_room.kind = 'inquiry' then
    update public.inquiries set first_reply_at = v_msg.created_at where room_id = p_room and to_user = v_me and first_reply_at is null;
  end if;

  if v_room.kind = 'official' then
    insert into public.support_threads (room_id, user_id, last_user_message_at) values (p_room, v_me, v_msg.created_at)
    on conflict (room_id) do update set status = 'open', last_user_message_at = excluded.last_user_message_at;
    return v_msg;
  end if;

  select display_name into v_sender_name from public.profiles where id = v_me;
  for r in
    select m.user_id, m.state, m.notify_level from public.room_members m
    where m.room_id = p_room and m.user_id <> v_me and m.state <> 'left' and not private.blocked(m.user_id, v_me)
  loop
    update public.room_members set hidden_at = null where room_id = p_room and user_id = r.user_id;
    if r.state = 'request' then
      perform private.notify(r.user_id, 'request', v_me, '/talk/requests', '新しいリクエスト {n}件', true);
    elsif (p_meta -> 'mentions') ? r.user_id::text or position('@全員' in coalesce(p_body, '')) > 0 then
      -- メンションは通知オフでも通知する（ZS-GRP-06）
      perform private.notify(r.user_id, 'mention', v_me, '/talk/' || p_room, v_sender_name || 'さんがあなたをメンションしました：' || left(v_preview, 40));
    elsif r.notify_level = 'all' then
      perform private.notify(r.user_id, 'message', v_me, '/talk/' || p_room,
        case when v_room.kind = 'group' then v_room.name || '：' else '' end || v_sender_name || '「' || left(v_preview, 40) || '」', true);
    end if;
  end loop;
  return v_msg;
end;
$$;

-- ZS-CHAT-20 送信取消（24時間以内）
create or replace function public.unsend_message(p_message bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.messages set unsent_at = now()
  where id = p_message and sender_id = auth.uid() and created_at > now() - interval '24 hours' and unsent_at is null;
  if not found then
    raise exception 'cannot_unsend' using hint = '送信から24時間を過ぎたメッセージは取り消せません';
  end if;
end;
$$;

-- 既読（2秒ごとにまとめて呼ぶ：16.5）
create or replace function public.mark_read(p_room uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.room_members set last_read_at = now()
  where room_id = p_room and user_id = auth.uid() and state = 'active';
  update public.notifications set read_at = now()
  where user_id = auth.uid() and target = '/talk/' || p_room and read_at is null;
$$;

-- ZS-SAFE-02 登録24時間以内は、友だち以外への新規トーク開始を1日10件まで
create or replace function private.check_new_talk(p_me uuid, p_target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created timestamptz;
  v_count int;
begin
  if exists (select 1 from public.friendships where user_id = p_me and friend_id = p_target) then
    return;
  end if;
  if private.has_restriction(p_me, array['new_talk', 'chat_send', 'chat_all']) then
    raise exception 'restricted' using hint = '現在、新しいトークの開始は制限されています';
  end if;
  select created_at into v_created from public.profiles where id = p_me;
  if v_created > now() - interval '24 hours' then
    select count(*) into v_count from public.rooms where owner_id = p_me and kind in ('direct', 'inquiry') and created_at > now() - interval '24 hours';
    if v_count >= coalesce((private.setting('new_user_daily_new_talks'))::int, 10) then
      raise exception 'rate_limited' using hint = '登録から24時間は、新しいトークの開始は1日10件までです';
    end if;
  end if;
end;
$$;

-- 1:1 トークを開く（ZS-SOC-02/03）。友だちでない相手には「リクエスト」として届く
create or replace function public.open_direct(p_target uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_key text;
  v_room uuid;
  v_policy text;
  v_added_me boolean;
begin
  if v_me is null or p_target = v_me then
    raise exception 'invalid';
  end if;
  if p_target = private.official_id() then
    return private.official_room(v_me);
  end if;
  v_key := least(v_me::text, p_target::text) || ':' || greatest(v_me::text, p_target::text);
  select id into v_room from public.rooms where direct_key = v_key;
  if v_room is not null then
    update public.room_members set state = case when state = 'left' then 'active' else state end, hidden_at = null where room_id = v_room and user_id = v_me;
    return v_room;
  end if;
  if private.blocked(p_target, v_me) then
    raise exception 'blocked';
  end if;
  select dm_policy into v_policy from public.profiles where id = p_target and status = 'active' and deleted_at is null;
  if v_policy is null then
    raise exception 'not_found';
  end if;
  v_added_me := exists (select 1 from public.friendships where user_id = p_target and friend_id = v_me);
  if v_policy = 'friends' and not v_added_me then
    raise exception 'dm_friends_only' using hint = 'この相手は友だちからのメッセージのみ受け付けています';
  end if;
  if v_policy = 'inquiry' and not v_added_me then
    raise exception 'dm_inquiry_only' using hint = 'この相手は作品の問い合わせのみ受け付けています';
  end if;
  perform private.check_new_talk(v_me, p_target);
  insert into public.rooms (kind, owner_id, direct_key, member_count) values ('direct', v_me, v_key, 2) returning id into v_room;
  insert into public.room_members (room_id, user_id, state) values
    (v_room, v_me, 'active'),
    (v_room, p_target, case when v_added_me then 'active' else 'request' end);
  return v_room;
end;
$$;

-- 6.4 作品詳細から問い合わせトークを開く（作品カードを先頭に添付）
create or replace function public.open_inquiry(p_work uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_work public.works;
  v_owner public.profiles;
  v_room uuid;
begin
  select * into v_work from public.works where id = p_work and status = 'active' and visibility in ('public', 'unlisted');
  if v_work.id is null then
    raise exception 'not_found';
  end if;
  select * into v_owner from public.profiles where id = v_work.owner_id;
  if v_owner.id = v_me then
    raise exception 'own_work';
  end if;
  if v_owner.commission_status = 'closed' then
    raise exception 'commission_closed' using hint = '現在は依頼を受け付けていません';
  end if;
  if private.blocked(v_owner.id, v_me) or private.blocked(v_me, v_owner.id) then
    raise exception 'blocked';
  end if;
  if v_owner.dm_policy = 'friends' and not exists (select 1 from public.friendships where user_id = v_owner.id and friend_id = v_me) then
    raise exception 'dm_friends_only';
  end if;
  select room_id into v_room from public.inquiries where work_id = p_work and from_user = v_me;
  if v_room is not null then
    return v_room;
  end if;
  perform private.check_new_talk(v_me, v_owner.id);
  insert into public.rooms (kind, owner_id, work_id, member_count) values ('inquiry', v_me, p_work, 2) returning id into v_room;
  insert into public.room_members (room_id, user_id) values (v_room, v_me), (v_room, v_owner.id);
  insert into public.inquiries (room_id, work_id, from_user, to_user) values (v_room, p_work, v_me, v_owner.id);
  insert into public.messages (room_id, sender_id, kind, meta, client_id) values (v_room, v_me, 'work', jsonb_build_object('workId', p_work), gen_random_uuid());
  update public.rooms set last_message_preview = '作品を共有しました', last_message_at = now() where id = v_room;
  update public.works set inquiry_count = inquiry_count + 1 where id = p_work;
  insert into public.work_daily_stats (work_id, date, inquiries) values (p_work, (now() at time zone 'Asia/Tokyo')::date, 1)
  on conflict (work_id, date) do update set inquiries = public.work_daily_stats.inquiries + 1;
  perform private.notify(v_owner.id, 'inquiry', v_me, '/talk/' || v_room,
    (select display_name from public.profiles where id = v_me) || 'さんから「' || v_work.title || '」への問い合わせが届きました');
  return v_room;
end;
$$;

-- 6.3 グループ作成（上限は設定値：Q-07 仮置き100人）
create or replace function public.create_group(p_name text, p_members uuid[], p_color text default '#22D3EE')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_room uuid;
  v_ids uuid[];
  v_max int := coalesce((private.setting('group_max_members'))::int, 100);
begin
  if private.has_restriction(v_me, array['chat_send', 'chat_all', 'freeze', 'ban']) then
    raise exception 'restricted' using hint = '現在、グループの作成は制限されています';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'empty_name';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_members, '{}')) x
  where x <> v_me and not private.blocked(x, v_me) and not private.blocked(v_me, x);
  if coalesce(cardinality(v_ids), 0) + 1 > v_max then
    raise exception 'group_full';
  end if;
  insert into public.rooms (kind, name, icon_color, owner_id, member_count) values ('group', left(btrim(p_name), 50), p_color, v_me, coalesce(cardinality(v_ids), 0) + 1)
  returning id into v_room;
  insert into public.room_members (room_id, user_id, role) values (v_room, v_me, 'owner');
  insert into public.room_members (room_id, user_id) select v_room, x from unnest(coalesce(v_ids, '{}')) x;
  insert into public.messages (room_id, sender_id, kind, body, client_id)
  values (v_room, v_me, 'system', (select display_name from public.profiles where id = v_me) || 'さんがグループを作成しました', gen_random_uuid());
  return v_room;
end;
$$;

-- 公式アカウントのトークに表示する配信（本文は broadcasts の1件を読み出す：9.2）
create or replace function public.official_feed(p_limit int default 50)
returns table (broadcast_id uuid, kind text, bubbles jsonb, sent_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.kind, b.bubbles, b.sent_at
  from public.broadcasts b
  join public.profiles me on me.id = auth.uid()
  where b.status = 'sent' and b.canceled_at is null
    and (
      (b.audience = 'all' and b.sent_at >= me.created_at)
      or exists (select 1 from public.broadcast_recipients r where r.broadcast_id = b.id and r.user_id = me.id)
    )
  order by b.sent_at desc
  limit p_limit
$$;

-- ---------------------------------------------------------------------------
-- ショーケース
-- ---------------------------------------------------------------------------
-- いいね数のキャッシュ（夜間に実数と照合して補正）と、まとめ通知
create or replace function private.on_like_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_work public.works;
begin
  if tg_op = 'INSERT' then
    update public.works set like_count = like_count + 1 where id = new.work_id returning * into v_work;
    insert into public.work_daily_stats (work_id, date, likes) values (new.work_id, (now() at time zone 'Asia/Tokyo')::date, 1)
    on conflict (work_id, date) do update set likes = public.work_daily_stats.likes + 1;
    if v_work.owner_id <> new.user_id then
      perform private.notify(v_work.owner_id, 'like', new.user_id, '/works/' || v_work.id, '「' || v_work.title || '」に{n}件のいいね', true);
    end if;
    return new;
  else
    update public.works set like_count = greatest(like_count - 1, 0) where id = old.work_id;
    return old;
  end if;
end;
$$;
create trigger likes_count after insert or delete on public.likes for each row execute function private.on_like_change();

-- 閲覧数と閲覧履歴（最大100件）
create or replace function public.record_view(p_work uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.works set view_count = view_count + 1 where id = p_work and owner_id is distinct from auth.uid() and status = 'active';
  if not found then
    return;
  end if;
  insert into public.work_daily_stats (work_id, date, views) values (p_work, (now() at time zone 'Asia/Tokyo')::date, 1)
  on conflict (work_id, date) do update set views = public.work_daily_stats.views + 1;
  if auth.uid() is not null then
    insert into public.view_history (user_id, work_id) values (auth.uid(), p_work)
    on conflict (user_id, work_id) do update set viewed_at = now();
    delete from public.view_history where user_id = auth.uid() and work_id in (
      select work_id from public.view_history where user_id = auth.uid() order by viewed_at desc offset 100
    );
  end if;
end;
$$;

-- ZS-WORK-20 通報と自動非表示（初期値3件）
create or replace function private.on_report_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reporters int;
  v_threshold int := coalesce((private.setting('report_auto_hide_threshold'))::int, 3);
  v_work public.works;
begin
  if new.target_type = 'work' then
    select count(distinct reporter_id) into v_reporters from public.reports where target_type = 'work' and target_id = new.target_id and status <> 'rejected';
    if v_reporters >= v_threshold then
      update public.works set status = 'hidden', hidden_reason = '通報が一定数に達したため、運営の確認まで非公開にしています'
      where id = new.target_id::uuid and status = 'active' returning * into v_work;
      if v_work.id is not null then
        perform private.notify(v_work.owner_id, 'important', null, '/me/works', '「' || v_work.title || '」は通報が一定数に達したため、運営の確認まで非公開になりました');
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger reports_auto_hide after insert on public.reports for each row execute function private.on_report_created();

-- 公開前の必須チェック（7.2）
create or replace function private.check_work_publish()
returns trigger
language plpgsql
as $$
begin
  if new.visibility in ('public', 'unlisted') and (old.visibility = 'draft' or tg_op = 'INSERT') then
    if char_length(btrim(new.title)) = 0 or new.category_id is null or new.production_type is null then
      raise exception 'work_incomplete' using hint = 'タイトル、カテゴリ、制作形態を入力してください';
    end if;
    if new.type in ('hp', 'lp') and new.url = '' then
      raise exception 'work_incomplete' using hint = '公開URLを入力してください';
    end if;
    if new.type = 'video' and new.video_url !~ '^https://(www\.)?(youtube\.com|youtu\.be|vimeo\.com)/' then
      raise exception 'work_incomplete' using hint = 'YouTube または Vimeo のURLを入力してください';
    end if;
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end;
$$;
create trigger works_publish_check before insert or update of visibility on public.works for each row execute function private.check_work_publish();

-- ---------------------------------------------------------------------------
-- 運営（すべて監査ログに残す）
-- ---------------------------------------------------------------------------
-- ZS-ADM-01/05/06 利用制限の実行（一括可）
create or replace function public.admin_restrict(
  p_users uuid[],
  p_kind text,
  p_ends_at timestamptz,
  p_reason text,
  p_user_message text default '',
  p_internal_note text default ''
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_ids uuid[] := '{}';
  v_id uuid;
  v_user uuid;
  v_label text := case p_kind
    when 'warning' then '警告' when 'chat_send' then 'チャット送信停止' when 'new_talk' then '新規トーク開始の停止'
    when 'chat_all' then 'チャット利用停止' when 'post' then '作品投稿停止' when 'freeze' then 'アカウント凍結' when 'ban' then '永久停止' end;
begin
  if p_kind in ('freeze', 'ban') then
    if not private.is_admin(array['owner', 'admin']) then raise exception 'forbidden'; end if;
  elsif not private.is_admin(array['owner', 'admin', 'moderator']) then
    raise exception 'forbidden';
  end if;
  if v_label is null then
    raise exception 'invalid_kind';
  end if;
  foreach v_user in array p_users loop
    if exists (select 1 from public.admin_members where user_id = v_user and role = 'owner') then
      raise exception 'cannot_restrict_owner';
    end if;
    insert into public.restrictions (user_id, kind, ends_at, reason_category, user_message, internal_note, created_by)
    values (v_user, p_kind, case when p_kind = 'warning' then now() when p_kind = 'ban' then null else p_ends_at end, p_reason, coalesce(p_user_message, ''), coalesce(p_internal_note, ''), v_me)
    returning id into v_id;
    v_ids := v_ids || v_id;
    if p_kind = 'freeze' then
      update public.profiles set status = 'frozen' where id = v_user;
    elsif p_kind = 'ban' then
      update public.profiles set status = 'banned' where id = v_user;
      insert into private.banned_identities (value_hash) select value_hash from private.identity_keys where user_id = v_user on conflict do nothing;
    end if;
    perform private.official_say(v_user, '【' || v_label || '】' || coalesce(nullif(p_user_message, ''), '利用規約に反する行為が確認されたため、利用を制限しています。') || E'\n理由：' || p_reason ||
      case when p_kind not in ('warning', 'ban') and p_ends_at is not null then E'\n解除予定：' || to_char(p_ends_at at time zone 'Asia/Tokyo', 'MM月DD日 HH24:MI') else '' end ||
      E'\n異議がある場合は、設定 > 利用制限 から申し立てができます。');
    perform private.audit(v_me, 'restriction.create.' || p_kind, 'user', v_user::text, null, jsonb_build_object('restriction_id', v_id, 'ends_at', p_ends_at, 'reason', p_reason));
  end loop;
  return v_ids;
end;
$$;

create or replace function public.admin_lift_restriction(p_restriction uuid, p_note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.restrictions;
begin
  select * into v_r from public.restrictions where id = p_restriction;
  if v_r.id is null then raise exception 'not_found'; end if;
  if not private.is_admin(case when v_r.kind in ('freeze', 'ban') then array['owner', 'admin'] else array['owner', 'admin', 'moderator'] end) then
    raise exception 'forbidden';
  end if;
  update public.restrictions set lifted_at = now() where id = p_restriction;
  if v_r.kind in ('freeze', 'ban') then
    update public.profiles set status = 'active' where id = v_r.user_id;
    delete from private.banned_identities where value_hash in (select value_hash from private.identity_keys where user_id = v_r.user_id);
  end if;
  perform private.official_say(v_r.user_id, '利用制限が解除されました');
  perform private.audit(auth.uid(), 'restriction.lift', 'user', v_r.user_id::text, jsonb_build_object('restriction_id', p_restriction), jsonb_build_object('note', p_note));
end;
$$;

-- ---------------------------------------------------------------------------
-- 定期処理（pg_cron から呼ぶ：0006）
-- ---------------------------------------------------------------------------
-- ZS-ADM-04 期限が来た制限を自動で解除し、公式アカウントから知らせる（5分ごと）
create or replace function private.lift_expired_restrictions()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.restrictions;
  n int := 0;
begin
  for r in
    update public.restrictions set lifted_at = ends_at
    where lifted_at is null and ends_at is not null and ends_at <= now() and kind <> 'warning'
    returning *
  loop
    if r.kind = 'freeze' then
      update public.profiles set status = 'active' where id = r.user_id and status = 'frozen';
    end if;
    perform private.official_say(r.user_id, '利用制限が解除されました');
    perform private.audit(null, 'restriction.auto_lift', 'user', r.user_id::text, jsonb_build_object('restriction_id', r.id), null);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- 16.4 保持ポリシー（毎日3:30 JST）。R2 のファイル削除は Edge Function `retention` が行う
create or replace function private.cleanup_retention()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications where created_at < now() - interval '90 days';
  delete from public.works where status = 'trashed' and deleted_at < now() - interval '30 days';
  delete from public.reports where resolved_at < now() - interval '1 year';
  delete from public.audit_logs where created_at < now() - interval '1 year';
  delete from private.device_hashes where last_seen_at < now() - interval '1 year';
  delete from public.attachments where expires_at is not null and expires_at < now();
  -- 退会申請から30日：個人情報を削除し、投稿とメッセージは「退会したユーザー」として残す
  update public.profiles
  set display_name = '退会したユーザー', bio = '', skills = '{}', links = '{}', avatar_key = null, cover_key = null, prefecture = null, interests = '{}', birth_ym = null
  where status = 'leaving' and deleted_at < now() - interval '30 days' and display_name <> '退会したユーザー';
  delete from private.identity_keys where user_id in (select id from public.profiles where status = 'leaving' and deleted_at < now() - interval '30 days');
end;
$$;

-- 集計値の補正と日次集計（毎日3:00 JST）
create or replace function private.reconcile_counts()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.works w set like_count = coalesce(l.n, 0)
  from (select w2.id, count(l2.*) as n from public.works w2 left join public.likes l2 on l2.work_id = w2.id group by w2.id) l
  where l.id = w.id and w.like_count <> coalesce(l.n, 0);
  update public.rooms r set member_count = m.n
  from (select room_id, count(*) as n from public.room_members where state = 'active' group by room_id) m
  where m.room_id = r.id and r.member_count <> m.n;
$$;

-- 無料枠の使用量の記録（毎日0:10 JST）：外部から取れない指標を DB 内で実測する
create or replace function private.record_usage()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.usage_snapshots (date, metric, value)
  values ((now() at time zone 'Asia/Tokyo')::date, 'db_bytes', pg_database_size(current_database()))
  on conflict (date, metric) do update set value = excluded.value;
$$;

grant execute on function public.complete_signup(text, text, text), public.record_device(text), public.change_handle(text), public.request_account_deletion(),
  public.send_message(uuid, text, uuid, text, bigint, jsonb), public.unsend_message(bigint), public.mark_read(uuid), public.open_direct(uuid),
  public.open_inquiry(uuid), public.create_group(text, uuid[], text), public.official_feed(int), public.record_view(uuid),
  public.admin_restrict(uuid[], text, timestamptz, text, text, text), public.admin_lift_restriction(uuid, text)
  to authenticated;
grant execute on function public.record_view(uuid) to anon;
revoke execute on function private.lift_expired_restrictions(), private.cleanup_retention(), private.reconcile_counts(), private.record_usage(),
  private.handle_new_user(), private.handle_new_identity() from authenticated;
