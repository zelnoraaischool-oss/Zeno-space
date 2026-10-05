-- =============================================================================
-- zenospace 0008: 画面から使う RPC の追加と、本番運用に向けた権限の見直し
-- フロントエンドの Supabase 実装（src/lib/api/supabase/）が呼ぶ関数をまとめる。
-- 返り値の JSON は列名のまま（snake_case）。画面用の型への変換はクライアント側で行う。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 権限の見直し
-- ---------------------------------------------------------------------------
-- RLS の判定関数は未ログイン（anon）でも評価されるため、anon にも実行を許可する
grant usage on schema private to anon;
grant execute on function private.blocked(uuid, uuid), private.is_admin(text[]), private.admin_role(uuid), private.is_room_member(uuid, uuid, boolean),
  private.has_restriction(uuid, text[]), private.room_kind(uuid), private.is_active_user(uuid) to anon;

-- 生年月は本人以外に見せない（列単位で select を外す）
revoke select on public.profiles from anon, authenticated;
grant select (id, handle, display_name, avatar_key, avatar_color, cover_key, bio, skills, links, prefecture, commission_status, dm_policy,
  profile_visibility, interests, status, is_official, handle_changed_at, onboarded, created_at, updated_at, last_login_at, deleted_at)
  on public.profiles to anon, authenticated;

-- 制限の社内メモは本人に見せない：本人向けは my_restrictions() を使い、テーブルは運営だけが読む
drop policy if exists restrictions_read on public.restrictions;
create policy restrictions_read on public.restrictions for select using (private.is_admin(array['owner', 'admin', 'moderator', 'viewer']));
drop view if exists public.my_restrictions;

-- メッセージリクエストを受けた人（state = request）も、承認する前に内容を読めるようにする（ZS-SOC-03）
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select
  using (
    private.is_room_member(room_id, auth.uid(), false)
    and (private.room_kind(room_id) = 'official' or not private.has_restriction(auth.uid(), array['chat_all']))
    and not exists (select 1 from public.message_hides h where h.message_id = messages.id and h.user_id = auth.uid())
    and not exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = messages.sender_id and messages.created_at >= b.created_at)
  );
drop policy if exists reactions_select on public.reactions;
create policy reactions_select on public.reactions for select
  using (exists (select 1 from public.messages m where m.id = message_id and private.is_room_member(m.room_id, auth.uid(), false)));
drop policy if exists room_members_select on public.room_members;
create policy room_members_select on public.room_members for select
  using (user_id = auth.uid() or private.is_room_member(room_id, auth.uid(), false));

alter table public.profiles alter column avatar_color set default '#3D6B52';
alter table public.rooms alter column icon_color set default '#3D6B52';

-- 他人に見せるプロフィール（生年月を除く）
create or replace function private.pub_profile(p public.profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$ select to_jsonb(p) - 'birth_ym' $$;

create or replace function private.add_system(p_room uuid, p_text text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.messages (room_id, sender_id, kind, body, client_id) values (p_room, p_actor, 'system', p_text, gen_random_uuid());
  update public.rooms set last_message_at = now(), last_message_preview = left(p_text, 80) where id = p_room;
end;
$$;

-- Edge Function の呼び出し（pg_cron）：Vault に URL と鍵を登録するまでは何もしない（毎分のエラーを出さない）
create or replace function private.invoke_edge_function(p_name text, p_body jsonb default '{}')
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  exception when others then
    return null;
  end;
  if v_url is null or v_key is null then
    return null;
  end if;
  return net.http_post(
    url := v_url || '/functions/v1/' || p_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := p_body,
    timeout_milliseconds := 30000
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- アカウント
-- ---------------------------------------------------------------------------
-- 新規登録の処理を更新：歓迎メッセージ（全員配信）を新規登録者にも見せる・アイコン色を深緑系にする
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
  v_colors text[] := array['#1F4D3B', '#3D6B52', '#5E7F6E', '#7A6A4F', '#8A5A44', '#4A5E6A', '#6B5B73', '#2F5D62'];
  v_room uuid;
begin
  if new.id = private.official_id() then
    return new;
  end if;
  if exists (select 1 from private.banned_identities b where b.value_hash = v_email_hash) then
    raise exception 'banned_identity' using errcode = 'P0001', hint = 'このメールアドレスでは登録できません';
  end if;
  if exists (select 1 from private.identity_keys k where k.kind = 'email' and k.value_hash = v_email_hash) then
    raise exception 'duplicate_account' using errcode = 'P0001', hint = 'このメールアドレスのアカウントはすでにあります';
  end if;
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

  insert into public.profiles (id, handle, display_name, avatar_color)
  values (new.id, v_handle, case when char_length(btrim(v_name)) = 0 then v_handle else v_name end,
    v_colors[1 + abs(hashtext(v_handle)) % array_length(v_colors, 1)]);
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

  insert into public.rooms (kind, name, icon_color, owner_id, member_count, last_message_preview)
  values ('official', 'zenospace 公式', '#1F4D3B', private.official_id(), 2, 'zenospace へようこそ！')
  returning id into v_room;
  insert into public.room_members (room_id, user_id, role, last_read_at) values (v_room, new.id, 'member', 'epoch'), (v_room, private.official_id(), 'owner', now());
  -- 歓迎メッセージ（「ようこそ」の全員配信）を新規登録者の宛先にも加える
  insert into public.broadcast_recipients (broadcast_id, user_id)
  select b.id, new.id from public.broadcasts b where b.title = 'ようこそ' and b.status = 'sent' and b.canceled_at is null
  on conflict do nothing;
  return new;
end;
$$;

-- 本人の状態（ログイン直後に1回で読む）
create or replace function public.my_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'settings', (select to_jsonb(s) from public.user_settings s where s.user_id = auth.uid()),
    'restrictions', coalesce((
      select jsonb_agg(to_jsonb(r) - 'internal_note' order by r.starts_at desc) from public.restrictions r
      where r.user_id = auth.uid() and r.lifted_at is null and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now())
    ), '[]'),
    'appeals', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.appeals a where a.user_id = auth.uid()), '[]'),
    'consents', coalesce((select jsonb_agg(to_jsonb(c)) from public.consents c where c.user_id = auth.uid()), '[]'),
    'admin_role', private.admin_role(auth.uid()),
    'friendships', coalesce((select jsonb_agg(to_jsonb(f)) from public.friendships f where f.user_id = auth.uid() or f.friend_id = auth.uid()), '[]'),
    'blocks', coalesce((select jsonb_agg(b.blocked_id) from public.blocks b where b.blocker_id = auth.uid()), '[]'),
    'liked_ids', coalesce((select jsonb_agg(l.work_id) from public.likes l where l.user_id = auth.uid()), '[]'),
    'dismissed_banners', coalesce((select jsonb_agg(d.banner_id) from public.banner_dismissals d where d.user_id = auth.uid()), '[]'),
    'unread_notifications', (select count(*) from public.notifications n where n.user_id = auth.uid() and n.read_at is null)
  ) end
$$;

-- 本人向けの有効な制限（社内メモを除く）
create or replace function public.my_restrictions()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(r) - 'internal_note' order by r.starts_at desc), '[]') from public.restrictions r
  where r.user_id = auth.uid() and r.lifted_at is null and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now())
$$;

-- ログイン画面で凍結・停止の理由を出す（本人のセッションで呼ぶ）
create or replace function public.my_lock()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.status in ('frozen', 'banned') then jsonb_build_object(
    'status', p.status,
    'restriction', (select to_jsonb(r) - 'internal_note' from public.restrictions r
      where r.user_id = p.id and r.kind in ('freeze', 'ban') and r.lifted_at is null order by r.starts_at desc limit 1)
  ) end
  from public.profiles p where p.id = auth.uid()
$$;

-- 凍結中でも異議申し立てはできる（ZS-ADM-07）
create or replace function public.submit_appeal(p_restriction uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'invalid' using hint = '申し立ての内容を入力してください';
  end if;
  if not exists (select 1 from public.restrictions r where r.id = p_restriction and r.user_id = auth.uid()) then
    raise exception 'not_found' using hint = '対象の制限が見つかりません';
  end if;
  insert into public.appeals (restriction_id, user_id, body) values (p_restriction, auth.uid(), left(p_body, 2000));
end;
$$;

-- 退会申請から30日以内のログインは復元（ZS-AUTH-09）
create or replace function public.restore_account()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set status = 'active', deleted_at = null
  where id = auth.uid() and status = 'leaving' and deleted_at > now() - interval '30 days';
  return found;
end;
$$;

-- 規約改定時の再同意
create or replace function public.agree_terms()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.consents (user_id, doc, version)
  select auth.uid(), d.doc, (private.setting(d.doc || '_version')) #>> '{}'
  from (values ('terms'), ('privacy')) d (doc)
  where auth.uid() is not null and private.setting(d.doc || '_version') is not null
  on conflict do nothing
$$;

-- 招待コードの発行（ZS-ONE-05）
create or replace function public.issue_invite_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(substr(md5(gen_random_uuid()::text), 1, 8));
begin
  if not private.is_active_user() then
    raise exception 'restricted';
  end if;
  insert into public.invite_codes (code, issued_by, expires_at) values (v_code, auth.uid(), now() + interval '14 days');
  perform private.notify(auth.uid(), 'important', null, '/settings/account', '招待コード ' || v_code || ' を発行しました');
  return v_code;
end;
$$;

-- 最初の運営オーナーを決める：運営メンバーがまだ1人もいないときだけ、呼んだ本人がオーナーになる
create or replace function public.claim_owner()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or exists (select 1 from public.admin_members) then
    return false;
  end if;
  insert into public.admin_members (user_id, role) values (auth.uid(), 'owner');
  perform private.audit(auth.uid(), 'admin.claim_owner', 'admin_member', auth.uid()::text, null, jsonb_build_object('role', 'owner'));
  return true;
end;
$$;

-- 運営コンソールに入れるか（まだオーナーがいない＝初期設定が必要か）
create or replace function public.admin_bootstrap_needed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select not exists (select 1 from public.admin_members) $$;

-- ---------------------------------------------------------------------------
-- プロフィール・つながり
-- ---------------------------------------------------------------------------
create or replace function public.profile_stats(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'work_count', (select count(*) from public.works w where w.owner_id = p_user and w.status = 'active' and w.visibility = 'public'),
    'like_total', (select coalesce(sum(w.like_count), 0) from public.works w where w.owner_id = p_user and w.status = 'active' and w.visibility = 'public'),
    'avg_reply_ms', (
      select (extract(epoch from percentile_disc(0.5) within group (order by i.first_reply_at - i.created_at)) * 1000)::bigint
      from public.inquiries i where i.to_user = p_user and i.first_reply_at is not null
    )
  )
$$;

-- 直近7日でいいねを多く集めた制作者
create or replace function public.featured_creators()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('profile', private.pub_profile(p), 'likes7d', s.n) order by s.n desc), '[]')
  from (
    select w.owner_id, sum(d.likes)::int as n
    from public.work_daily_stats d join public.works w on w.id = d.work_id
    where d.date >= (now() at time zone 'Asia/Tokyo')::date - 7 and w.status = 'active' and w.visibility = 'public'
    group by w.owner_id having sum(d.likes) > 0
    order by n desc limit 8
  ) s
  join public.profiles p on p.id = s.owner_id
  where not p.is_official and p.status = 'active' and p.deleted_at is null
    and (auth.uid() is null or not private.blocked(p.id, auth.uid()))
$$;

-- ZS-SOC-06 知り合いかも：同じグループの参加者と、あなたを追加した人
create or replace function public.friend_suggestions()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.pub_profile(p)), '[]')
  from public.profiles p
  where p.id in (
      select m2.user_id from public.room_members m1
      join public.rooms r on r.id = m1.room_id and r.kind = 'group'
      join public.room_members m2 on m2.room_id = m1.room_id and m2.state = 'active'
      where m1.user_id = auth.uid() and m1.state = 'active'
      union
      select f.user_id from public.friendships f where f.friend_id = auth.uid()
    )
    and p.id <> auth.uid() and not p.is_official and p.deleted_at is null and p.status = 'active'
    and not exists (select 1 from public.friendships f where f.user_id = auth.uid() and f.friend_id = p.id)
    and not private.blocked(auth.uid(), p.id) and not private.blocked(p.id, auth.uid())
$$;

-- 友だち追加を相手に知らせる
create or replace function private.on_friend_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
begin
  select * into v_me from public.profiles where id = new.user_id;
  perform private.notify(new.friend_id, 'friend', new.user_id, '/u/' || v_me.handle, v_me.display_name || 'さんがあなたを友だちに追加しました');
  return new;
end;
$$;
drop trigger if exists friendships_notify on public.friendships;
create trigger friendships_notify after insert on public.friendships for each row execute function private.on_friend_added();

-- ブロックしたら自分側の友だち登録も外す
create or replace function private.on_block_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.friendships where user_id = new.blocker_id and friend_id = new.blocked_id;
  return new;
end;
$$;
drop trigger if exists blocks_unfriend on public.blocks;
create trigger blocks_unfriend after insert on public.blocks for each row execute function private.on_block_added();

-- ---------------------------------------------------------------------------
-- チャット
-- ---------------------------------------------------------------------------
-- トークリスト：ルーム・自分の参加状態・相手・未読数をまとめて返す
create or replace function public.my_rooms()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select r, m from public.room_members m join public.rooms r on r.id = m.room_id
    where m.user_id = auth.uid() and m.state in ('active', 'request')
      and (r.kind = 'official' or not private.has_restriction(auth.uid(), array['chat_all']))
  ),
  feed as (select f.sent_at, jsonb_array_length(f.bubbles) as n, f.bubbles from public.official_feed(200) f)
  select coalesce(jsonb_agg(jsonb_build_object(
    'room', to_jsonb((x.r)),
    'member', to_jsonb((x.m)),
    'peer', case when (x.r).kind in ('direct', 'inquiry') then (
      select private.pub_profile(p) from public.room_members o join public.profiles p on p.id = o.user_id
      where o.room_id = (x.r).id and o.user_id <> auth.uid() order by o.joined_at limit 1) end,
    'work', case when (x.r).work_id is not null then (select to_jsonb(w) from public.works w where w.id = (x.r).work_id) end,
    'unread', case when (x.m).state = 'request' then 0 else (
      select count(*) from public.messages msg
      where msg.room_id = (x.r).id and msg.sender_id <> auth.uid() and msg.kind <> 'system' and msg.created_at > (x.m).last_read_at
        and not exists (select 1 from public.message_hides h where h.message_id = msg.id and h.user_id = auth.uid())
        and not exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = msg.sender_id and msg.created_at >= b.created_at)
    ) + case when (x.r).kind = 'official' then (select coalesce(sum(feed.n), 0) from feed where feed.sent_at > (x.m).last_read_at) else 0 end end,
    'last_feed_at', case when (x.r).kind = 'official' then (select max(feed.sent_at) from feed) end,
    'last_feed', case when (x.r).kind = 'official' then (select feed.bubbles -> 0 from feed order by feed.sent_at desc limit 1) end
  )), '[]')
  from mine x
$$;

-- 既読：公式アカウントのトークでは配信の開封も記録する（ZS-BC-08）
create or replace function public.mark_read(p_room uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.room_members set last_read_at = greatest(now(), last_read_at)
  where room_id = p_room and user_id = auth.uid() and state = 'active';
  update public.notifications set read_at = now()
  where user_id = auth.uid() and target = '/talk/' || p_room and read_at is null;
  if private.room_kind(p_room) = 'official' then
    insert into public.broadcast_events (broadcast_id, user_id, kind)
    select f.broadcast_id, auth.uid(), 'read' from public.official_feed(200) f
    on conflict do nothing;
  end if;
end;
$$;

-- 公式アカウントへの最初の問い合わせに自動で受付の返事をする（ZS-OFC-04）
create or replace function private.on_support_thread_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.official_say(new.user_id, 'お問い合わせありがとうございます。運営チームが順に確認し、このトークでお返事します（受付時間 平日10:00〜18:00）。', false, null);
  return new;
end;
$$;
drop trigger if exists support_threads_autoreply on public.support_threads;
create trigger support_threads_autoreply after insert on public.support_threads for each row execute function private.on_support_thread_created();

-- メッセージの追加を参加者の個人チャンネルへ知らせる（トークリストと未読バッジの更新）
create or replace function private.notify_room_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  for v_user in select user_id from public.room_members where room_id = new.room_id and state <> 'left' and user_id <> new.sender_id and user_id <> private.official_id() loop
    perform realtime.send(jsonb_build_object('room_id', new.room_id, 'message_id', new.id), 'room', 'user:' || v_user::text, true);
  end loop;
  return null;
end;
$$;
drop trigger if exists messages_notify_members on public.messages;
create trigger messages_notify_members after insert on public.messages for each row execute function private.notify_room_members();

-- 通知の追加・既読を本人のチャンネルへ（未読バッジの即時更新）
create or replace function private.broadcast_notification_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(jsonb_build_object('id', new.id), 'notification', 'user:' || new.user_id::text, true);
  return null;
end;
$$;
drop trigger if exists notifications_broadcast on public.notifications;
create trigger notifications_broadcast after insert or update on public.notifications for each row execute function private.broadcast_notification_change();

-- 既読とリアクションの変化をルームのチャンネルへ（相手の画面の「既読」とリアクションを即時に更新）
create or replace function private.broadcast_read_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.last_read_at is distinct from old.last_read_at or new.state is distinct from old.state or new.role is distinct from old.role then
    perform realtime.send(jsonb_build_object('user_id', new.user_id), 'member', 'room:' || new.room_id::text, true);
  end if;
  return null;
end;
$$;
drop trigger if exists room_members_broadcast on public.room_members;
create trigger room_members_broadcast after update on public.room_members for each row execute function private.broadcast_read_change();

create or replace function private.broadcast_reaction_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid;
begin
  select room_id into v_room from public.messages where id = coalesce(new.message_id, old.message_id);
  if v_room is not null then
    perform realtime.send(jsonb_build_object('message_id', coalesce(new.message_id, old.message_id)), 'reaction', 'room:' || v_room::text, true);
  end if;
  return null;
end;
$$;
drop trigger if exists reactions_broadcast on public.reactions;
create trigger reactions_broadcast after insert or delete on public.reactions for each row execute function private.broadcast_reaction_change();

-- グループ操作の共通チェック
create or replace function private.require_group_admin(p_room uuid, p_owner_only boolean default false)
returns public.room_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.room_members;
begin
  select * into v_m from public.room_members where room_id = p_room and user_id = auth.uid() and state = 'active';
  if v_m.user_id is null then
    raise exception 'not_found' using hint = 'トークが見つかりません';
  end if;
  if p_owner_only and v_m.role <> 'owner' then
    raise exception 'forbidden' using hint = 'オーナーのみ操作できます';
  end if;
  if v_m.role = 'member' then
    raise exception 'forbidden' using hint = '管理者のみ操作できます';
  end if;
  return v_m;
end;
$$;

create or replace function public.room_invite_members(p_room uuid, p_users uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_max int := coalesce((private.setting('group_max_members'))::int, 100);
  v_count int;
begin
  if not private.is_room_member(p_room) or private.room_kind(p_room) <> 'group' then
    raise exception 'not_found' using hint = 'グループが見つかりません';
  end if;
  if private.has_restriction(auth.uid(), array['chat_send', 'chat_all', 'freeze', 'ban']) then
    raise exception 'restricted' using hint = '現在、グループへの招待は制限されています';
  end if;
  foreach v_user in array coalesce(p_users, '{}') loop
    continue when exists (select 1 from public.room_members where room_id = p_room and user_id = v_user and state = 'active');
    continue when private.blocked(v_user, auth.uid()) or private.blocked(auth.uid(), v_user);
    select count(*) into v_count from public.room_members where room_id = p_room and state = 'active';
    if v_count + 1 > v_max then
      raise exception 'group_full' using hint = 'グループは' || v_max || '人までです';
    end if;
    insert into public.room_members (room_id, user_id) values (p_room, v_user)
    on conflict (room_id, user_id) do update set state = 'active', joined_at = now(), last_read_at = now();
    perform private.add_system(p_room, (select display_name from public.profiles where id = v_user) || 'さんが参加しました', auth.uid());
  end loop;
  update public.rooms set member_count = (select count(*) from public.room_members where room_id = p_room and state = 'active') where id = p_room;
end;
$$;

create or replace function public.room_create_invite(p_room uuid, p_ttl_hours int, p_requires_approval boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := replace(replace(rtrim(encode(extensions.gen_random_bytes(9), 'base64'), '='), '+', '-'), '/', '_');
begin
  perform private.require_group_admin(p_room);
  if private.has_restriction(auth.uid(), array['chat_send', 'chat_all']) then
    raise exception 'restricted' using hint = '現在、グループへの招待は制限されています';
  end if;
  insert into public.room_invites (token, room_id, expires_at, requires_approval, created_by)
  values (v_token, p_room, case when p_ttl_hours is null then null else now() + make_interval(hours => p_ttl_hours) end, coalesce(p_requires_approval, false), auth.uid());
  return v_token;
end;
$$;

create or replace function public.room_invite_info(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('room', to_jsonb(r), 'requires_approval', i.requires_approval, 'expired', i.expires_at is not null and i.expires_at < now())
  from public.room_invites i join public.rooms r on r.id = i.room_id
  where i.token = p_token
$$;

create or replace function public.room_join_by_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.room_invites;
  v_state text;
  v_existing text;
  v_max int := coalesce((private.setting('group_max_members'))::int, 100);
begin
  select * into v_inv from public.room_invites where token = p_token;
  if v_inv.token is null or (v_inv.expires_at is not null and v_inv.expires_at < now()) then
    raise exception 'invalid' using hint = '招待リンクの有効期限が切れています';
  end if;
  if not private.is_active_user() then
    raise exception 'restricted';
  end if;
  select state into v_existing from public.room_members where room_id = v_inv.room_id and user_id = auth.uid();
  if v_existing = 'active' then
    return jsonb_build_object('room_id', v_inv.room_id, 'pending', false);
  end if;
  if (select count(*) from public.room_members where room_id = v_inv.room_id and state = 'active') + 1 > v_max then
    raise exception 'group_full' using hint = 'このグループは上限人数に達しています';
  end if;
  v_state := case when v_inv.requires_approval then 'request' else 'active' end;
  insert into public.room_members (room_id, user_id, state) values (v_inv.room_id, auth.uid(), v_state)
  on conflict (room_id, user_id) do update set state = excluded.state, joined_at = now(), last_read_at = now();
  if v_state = 'active' then
    perform private.add_system(v_inv.room_id, (select display_name from public.profiles where id = auth.uid()) || 'さんが参加しました', auth.uid());
    update public.rooms set member_count = member_count + 1 where id = v_inv.room_id;
  end if;
  return jsonb_build_object('room_id', v_inv.room_id, 'pending', v_state = 'request');
end;
$$;

create or replace function public.room_approve_join(p_room uuid, p_user uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_group_admin(p_room);
  if p_approve then
    update public.room_members set state = 'active', joined_at = now() where room_id = p_room and user_id = p_user and state = 'request';
    if found then
      update public.rooms set member_count = member_count + 1 where id = p_room;
      perform private.add_system(p_room, (select display_name from public.profiles where id = p_user) || 'さんが参加しました', auth.uid());
    end if;
  else
    update public.room_members set state = 'left' where room_id = p_room and user_id = p_user and state = 'request';
  end if;
end;
$$;

create or replace function public.room_set_role(p_room uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_group_admin(p_room, true);
  if p_role not in ('admin', 'member') then
    raise exception 'invalid';
  end if;
  update public.room_members set role = p_role where room_id = p_room and user_id = p_user and role <> 'owner';
end;
$$;

create or replace function public.room_remove_member(p_room uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_group_admin(p_room);
  update public.room_members set state = 'left' where room_id = p_room and user_id = p_user and role <> 'owner' and state = 'active';
  if not found then
    raise exception 'forbidden' using hint = 'オーナーは退出させられません';
  end if;
  update public.rooms set member_count = greatest(member_count - 1, 0) where id = p_room;
  perform private.add_system(p_room, (select display_name from public.profiles where id = p_user) || 'さんが退出しました', auth.uid());
end;
$$;

create or replace function public.room_leave(p_room uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.room_members;
  v_kind text := private.room_kind(p_room);
begin
  select * into v_m from public.room_members where room_id = p_room and user_id = auth.uid() and state <> 'left';
  if v_m.user_id is null then
    raise exception 'not_found' using hint = 'トークが見つかりません';
  end if;
  if v_kind = 'official' then
    raise exception 'forbidden' using hint = '公式アカウントのトークは退出できません';
  end if;
  update public.room_members set state = 'left', role = 'member' where room_id = p_room and user_id = auth.uid();
  if v_kind = 'group' then
    if v_m.role = 'owner' then
      update public.room_members set role = 'owner'
      where room_id = p_room and user_id = (select user_id from public.room_members where room_id = p_room and state = 'active' order by role = 'admin' desc, joined_at limit 1);
    end if;
    update public.rooms set member_count = greatest(member_count - 1, 0) where id = p_room;
    perform private.add_system(p_room, (select display_name from public.profiles where id = auth.uid()) || 'さんが退出しました', auth.uid());
  end if;
end;
$$;

create or replace function public.room_dissolve(p_room uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_group_admin(p_room, true);
  if private.room_kind(p_room) <> 'group' then
    raise exception 'forbidden' using hint = 'オーナーのみ解散できます';
  end if;
  perform private.add_system(p_room, 'グループは解散されました', auth.uid());
  update public.room_members set state = 'left' where room_id = p_room;
  update public.rooms set member_count = 0 where id = p_room;
end;
$$;

create or replace function public.room_update_group(p_room uuid, p_name text, p_color text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_group_admin(p_room);
  update public.rooms set name = coalesce(nullif(left(btrim(p_name), 50), ''), name), icon_color = coalesce(p_color, icon_color) where id = p_room;
end;
$$;

-- ZS-GRP-05 アナウンス（最大3件）
create or replace function public.room_pin_announcement(p_room uuid, p_message bigint, p_pin boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.room_members;
begin
  select * into v_m from public.room_members where room_id = p_room and user_id = auth.uid() and state = 'active';
  if v_m.user_id is null then
    raise exception 'not_found';
  end if;
  if private.room_kind(p_room) = 'group' and v_m.role = 'member' then
    raise exception 'forbidden' using hint = 'アナウンスは管理者が設定できます';
  end if;
  delete from public.room_announcements where room_id = p_room and message_id = p_message;
  if p_pin then
    if (select count(*) from public.room_announcements where room_id = p_room) >= 3 then
      raise exception 'invalid' using hint = 'アナウンスは3件までです';
    end if;
    insert into public.room_announcements (room_id, message_id, pinned_by)
    select p_room, p_message, auth.uid() where exists (select 1 from public.messages where id = p_message and room_id = p_room);
  end if;
end;
$$;

-- メッセージリクエスト（ZS-SOC-03）
create or replace function public.request_respond(p_room uuid, p_accept boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.room_members set state = case when p_accept then 'active' else 'left' end, last_read_at = case when p_accept then last_read_at else now() end
  where room_id = p_room and user_id = auth.uid() and state = 'request'
$$;

-- 退出・削除したトークを開き直す（state は列権限で直接変えられないため）
create or replace function public.room_reopen(p_room uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.room_members set hidden_at = null where room_id = p_room and user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- ショーケース
-- ---------------------------------------------------------------------------
-- 作品の保存（タグはマスタに無ければ追加する。使用技術・画像も入れ替える）
create or replace function public.save_work(p_work uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_w public.works;
  v_tag text;
  v_tag_id uuid;
  v_i int := 0;
  v_media jsonb;
begin
  select * into v_w from public.works where id = p_work;
  if v_w.id is null or v_w.owner_id <> auth.uid() then
    raise exception 'not_found' using hint = '作品が見つかりません';
  end if;
  if not private.is_active_user() or private.has_restriction(auth.uid(), array['post']) then
    raise exception 'restricted' using hint = '現在、作品の投稿と編集は制限されています';
  end if;
  update public.works set
    type = coalesce(p_data ->> 'type', type),
    title = coalesce(p_data ->> 'title', title),
    catch_copy = coalesce(p_data ->> 'catch_copy', catch_copy),
    description = coalesce(p_data ->> 'description', description),
    category_id = case when p_data ? 'category_id' then (p_data ->> 'category_id')::uuid else category_id end,
    production_type = case when p_data ? 'production_type' then p_data ->> 'production_type' else production_type end,
    roles = case when p_data ? 'roles' then array(select jsonb_array_elements_text(p_data -> 'roles')) else roles end,
    period_value = case when p_data ? 'period_value' then (p_data ->> 'period_value')::int else period_value end,
    period_unit = case when p_data ? 'period_unit' then p_data ->> 'period_unit' else period_unit end,
    price_min = case when p_data ? 'price_min' then (p_data ->> 'price_min')::int else price_min end,
    price_max = case when p_data ? 'price_max' then (p_data ->> 'price_max')::int else price_max end,
    url = coalesce(p_data ->> 'url', url),
    store_url = coalesce(p_data ->> 'store_url', store_url),
    video_url = coalesce(p_data ->> 'video_url', video_url),
    license_confirmed = coalesce((p_data ->> 'license_confirmed')::boolean, license_confirmed)
  where id = p_work;

  if p_data ? 'tech_ids' then
    delete from public.work_techs where work_id = p_work;
    insert into public.work_techs (work_id, tech_id)
    select p_work, t::uuid from jsonb_array_elements_text(p_data -> 'tech_ids') t
    where exists (select 1 from public.techs x where x.id = t::uuid)
    on conflict do nothing;
  end if;

  if p_data ? 'tags' then
    delete from public.work_tags where work_id = p_work;
    for v_tag in select distinct left(btrim(t), 30) from jsonb_array_elements_text(p_data -> 'tags') t where btrim(t) <> '' limit 10 loop
      insert into public.tags (name, normalized_name) values (v_tag, lower(v_tag))
      on conflict (normalized_name) do update set name = public.tags.name
      returning id into v_tag_id;
      insert into public.work_tags (work_id, tag_id) values (p_work, v_tag_id) on conflict do nothing;
    end loop;
  end if;

  if p_data ? 'media' then
    if jsonb_array_length(p_data -> 'media') > 11 then
      raise exception 'invalid' using hint = '画像は10枚までです';
    end if;
    delete from public.work_media where work_id = p_work;
    for v_media in select * from jsonb_array_elements(p_data -> 'media') loop
      insert into public.work_media (work_id, storage_key, width, height, bytes, sort_order, alt_text, dominant_color)
      values (p_work, v_media ->> 'url', coalesce((v_media ->> 'width')::int, 0), coalesce((v_media ->> 'height')::int, 0),
        coalesce((v_media ->> 'bytes')::int, 0), v_i, coalesce(v_media ->> 'altText', ''), coalesce(v_media ->> 'dominantColor', '#D8D6D0'));
      v_i := v_i + 1;
    end loop;
  end if;
end;
$$;

-- ゴミ箱へ移す・戻す（ZS-WORK-05：30日間は戻せる）
create or replace function public.work_set_trashed(p_work uuid, p_trashed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.works
  set status = case when p_trashed then 'trashed' when status = 'trashed' then 'active' else status end,
      deleted_at = case when p_trashed then now() else null end
  where id = p_work and owner_id = auth.uid();
  if not found then
    raise exception 'not_found' using hint = '作品が見つかりません';
  end if;
end;
$$;

-- 作品検索を作り直す：タグの条件、ブロック関係、停止・退会した制作者の除外を加える
create or replace function public.search_works(p_query jsonb default '{}', p_offset int default 0, p_limit int default 24)
returns table (id uuid, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select
      nullif(btrim(p_query ->> 'q'), '') as text,
      array(select jsonb_array_elements_text(coalesce(p_query -> 'types', '[]'))) as types,
      array(select jsonb_array_elements_text(coalesce(p_query -> 'categoryIds', '[]'))::uuid) as cats,
      array(select jsonb_array_elements_text(coalesce(p_query -> 'techIds', '[]'))::uuid) as techs,
      array(select lower(jsonb_array_elements_text(coalesce(p_query -> 'tags', '[]')))) as tags,
      array(select jsonb_array_elements_text(coalesce(p_query -> 'productionTypes', '[]'))) as prods,
      (p_query ->> 'priceMin')::int as pmin,
      (p_query ->> 'priceMax')::int as pmax,
      coalesce((p_query ->> 'openOnly')::boolean, false) as open_only,
      (p_query ->> 'ownerId')::uuid as owner,
      coalesce(p_query ->> 'sort', 'new') as sort
  ),
  hits as (
    select w.id, w.like_count, w.view_count, w.published_at,
      (select coalesce(sum(s.likes), 0) from public.work_daily_stats s where s.work_id = w.id and s.date >= current_date - 7) as pop
    from public.works w
    join public.profiles p on p.id = w.owner_id
    cross join q
    where w.status = 'active' and w.visibility = 'public' and w.published_at is not null and w.deleted_at is null
      and p.status not in ('banned', 'frozen') and p.deleted_at is null
      and (auth.uid() is null or (not private.blocked(w.owner_id, auth.uid()) and not private.blocked(auth.uid(), w.owner_id)))
      and (q.text is null or w.search_text operator(extensions.&@~) q.text)
      and (cardinality(q.types) = 0 or w.type = any (q.types))
      and (cardinality(q.cats) = 0 or w.category_id = any (q.cats))
      and (cardinality(q.techs) = 0 or exists (select 1 from public.work_techs t where t.work_id = w.id and t.tech_id = any (q.techs)))
      and (cardinality(q.tags) = 0 or exists (select 1 from public.work_tags wt join public.tags tg on tg.id = wt.tag_id where wt.work_id = w.id and tg.normalized_name = any (q.tags)))
      and (cardinality(q.prods) = 0 or w.production_type = any (q.prods))
      and (q.pmin is null or coalesce(w.price_max, w.price_min, -1) >= q.pmin)
      and (q.pmax is null or coalesce(w.price_min, 2147483647) <= q.pmax)
      and (not q.open_only or p.commission_status = 'open')
      and (q.owner is null or w.owner_id = q.owner)
  )
  select h.id, count(*) over () as total
  from hits h, q
  order by
    case when q.sort = 'popular' then h.pop end desc nulls last,
    case when q.sort = 'likes' then h.like_count end desc nulls last,
    case when q.sort = 'views' then h.view_count end desc nulls last,
    h.published_at desc
  offset p_offset limit p_limit
$$;

-- 絞り込みの選択肢ごとの件数（その条件だけを外して数える：14.3）
create or replace function public.search_facets(p_query jsonb default '{}')
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'types', coalesce((select jsonb_object_agg(k, n) from (
      select w.type k, count(*) n from public.search_works(p_query - 'types', 0, 100000) s join public.works w on w.id = s.id group by w.type) x), '{}'),
    'categories', coalesce((select jsonb_object_agg(k, n) from (
      select w.category_id::text k, count(*) n from public.search_works(p_query - 'categoryIds', 0, 100000) s join public.works w on w.id = s.id
      where w.category_id is not null group by w.category_id) x), '{}'),
    'techs', coalesce((select jsonb_object_agg(k, n) from (
      select t.tech_id::text k, count(*) n from public.search_works(p_query - 'techIds', 0, 100000) s join public.work_techs t on t.work_id = s.id group by t.tech_id) x), '{}'),
    'productionTypes', coalesce((select jsonb_object_agg(k, n) from (
      select w.production_type k, count(*) n from public.search_works(p_query - 'productionTypes', 0, 100000) s join public.works w on w.id = s.id
      where w.production_type is not null group by w.production_type) x), '{}'),
    'openOnly', (select count(*) from public.search_works(p_query || '{"openOnly":true}', 0, 100000))
  )
$$;

-- ZS-HOME-04 おすすめ：興味タグといいねした作品のタグの一致度で並べる
create or replace function public.recommended_works(p_offset int default 0, p_limit int default 24)
returns table (id uuid, total bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with liked as (
    select t.normalized_name n, count(*) c from public.likes l
    join public.work_tags wt on wt.work_id = l.work_id join public.tags t on t.id = wt.tag_id
    where l.user_id = auth.uid() group by t.normalized_name
  ),
  interests as (
    select lower(i) i from public.profiles p, unnest(p.interests) i where p.id = auth.uid()
  ),
  pool as (
    select s.id from public.search_works('{}'::jsonb, 0, 100000) s
  ),
  scored as (
    select w.id, w.published_at,
      (select coalesce(sum(l.c), 0) from public.work_tags wt join public.tags t on t.id = wt.tag_id join liked l on l.n = t.normalized_name where wt.work_id = w.id)
      + 2 * (select count(*) from interests x where lower(w.search_text) like '%' || x.i || '%')
      + w.like_count / 500.0 as score
    from public.works w join pool on pool.id = w.id
    where auth.uid() is null or w.owner_id <> auth.uid()
  )
  select s.id, count(*) over () from scored s order by s.score desc, s.published_at desc offset p_offset limit p_limit
$$;

-- 関連作品：同じ制作者と、カテゴリ・タグ・使用技術・種類が近い作品
create or replace function public.related_works(p_work uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (select * from public.works where id = p_work),
  pool as (select s.id from public.search_works('{}'::jsonb, 0, 100000) s where s.id <> p_work)
  select jsonb_build_object(
    'same_owner', coalesce((select jsonb_agg(x.id) from (
      select w.id from public.works w join pool on pool.id = w.id, base b where w.owner_id = b.owner_id order by w.published_at desc limit 6) x), '[]'),
    'similar', coalesce((select jsonb_agg(x.id) from (
      select w.id,
        (case when w.category_id = b.category_id then 2 else 0 end)
        + (select count(*) from public.work_tags a join public.work_tags c on c.tag_id = a.tag_id where a.work_id = w.id and c.work_id = b.id)
        + (select count(*) from public.work_techs a join public.work_techs c on c.tech_id = a.tech_id where a.work_id = w.id and c.work_id = b.id)
        + (case when w.type = b.type then 1 else 0 end) as score
      from public.works w join pool on pool.id = w.id, base b
      where w.owner_id <> b.owner_id
      order by score desc, w.like_count desc limit 8) x where x.score > 0), '[]')
  )
$$;

create or replace function public.popular_tags()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.name), '[]') from (
    select t.name from public.work_tags wt join public.tags t on t.id = wt.tag_id join public.works w on w.id = wt.work_id
    where w.status = 'active' and w.visibility = 'public'
    group by t.id, t.name order by count(*) desc, t.name limit 30
  ) x
$$;

-- AIニュースの「役に立った」の件数（本人以外の反応はテーブルから読めないため集計だけ返す）
create or replace function public.news_useful_counts(p_items uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(item_id, n), '{}') from (
    select item_id, count(*) n from public.news_reactions where kind = 'useful' and item_id = any (p_items) group by item_id
  ) x
$$;

-- ---------------------------------------------------------------------------
-- 運営
-- ---------------------------------------------------------------------------
create or replace function private.user_state(p public.profiles)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p.status = 'banned' then 'banned'
    when p.status = 'frozen' then 'frozen'
    when p.status = 'leaving' then 'leaving'
    when private.has_restriction(p.id, array['chat_send', 'new_talk', 'chat_all', 'post']) then 'restricted'
    else 'normal' end
$$;

create or replace function private.mask_email(e text)
returns text
language sql
immutable
as $$ select left(split_part(e, '@', 1), 2) || '***@' || split_part(e, '@', 2) $$;

-- A-02 ダッシュボード
create or replace function public.admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_users int;
  v_dau int;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  select count(*) into v_users from public.profiles where not is_official and deleted_at is null;
  select count(*) into v_dau from public.profiles where not is_official and deleted_at is null and last_login_at > now() - interval '1 day';
  return jsonb_build_object(
    'dau', v_dau,
    'wau', (select count(*) from public.profiles where not is_official and deleted_at is null and last_login_at > now() - interval '7 days'),
    'mau', (select count(*) from public.profiles where not is_official and deleted_at is null and last_login_at > now() - interval '30 days'),
    'total_users', v_users,
    'new_users', (select jsonb_agg(c order by d) from (select d, (select count(*) from public.profiles p where not p.is_official and p.created_at >= d and p.created_at < d + interval '1 day') c
      from generate_series(now() - interval '13 days', now(), interval '1 day') d) x),
    'messages', (select jsonb_agg(c order by d) from (select d, (select count(*) from public.messages m where m.kind <> 'system' and m.created_at >= d - interval '1 day' and m.created_at < d) c
      from generate_series(now() - interval '13 days', now(), interval '1 day') d) x),
    'new_works', (select jsonb_agg(c order by d) from (select d, (select count(*) from public.works w where w.published_at >= d - interval '1 day' and w.published_at < d) c
      from generate_series(now() - interval '13 days', now(), interval '1 day') d) x),
    'inquiries', (select jsonb_agg(c order by d) from (select d, (select count(*) from public.inquiries i where i.created_at >= d - interval '1 day' and i.created_at < d) c
      from generate_series(now() - interval '13 days', now(), interval '1 day') d) x),
    'registrations30', (select jsonb_agg(c order by d) from (select d, (select count(*) from public.profiles p where not p.is_official and p.created_at < d) c
      from generate_series(now() - interval '29 days', now(), interval '1 day') d) x),
    'active30', (select jsonb_agg(c order by d) from (select d, (select count(distinct m.sender_id) from public.messages m where m.created_at >= d - interval '1 day' and m.created_at < d) c
      from generate_series(now() - interval '29 days', now(), interval '1 day') d) x),
    'open_reports', (select count(*) from public.reports where status in ('open', 'in_progress')),
    'overdue_reports', (select count(*) from public.reports where status in ('open', 'in_progress') and created_at < now() - interval '1 day'),
    'pending_broadcasts', (select count(*) from public.broadcasts where status = 'pending'),
    'scheduled_broadcasts', coalesce((select jsonb_agg(to_jsonb(b) order by b.scheduled_at) from public.broadcasts b where b.status = 'scheduled'), '[]'),
    'news_today', (select to_jsonb(g) from public.news_digests g where g.date = (now() at time zone 'Asia/Tokyo')::date),
    'dup_open', (select count(*) from public.dup_suspicions where status = 'open'),
    'appeals_open', (select count(*) from public.appeals where status = 'open'),
    'failing_sources', coalesce((select jsonb_agg(to_jsonb(s)) from public.news_sources s where s.enabled and s.failure_count > 0), '[]'),
    'post_rate', case when v_users = 0 then 0 else (select count(distinct owner_id) from public.works where visibility = 'public' and status = 'active')::numeric / v_users end,
    'chat_activity', case when v_dau = 0 then 0 else (select count(*) from public.messages where created_at > now() - interval '1 day' and kind <> 'system') / v_dau end
  );
end;
$$;

-- ZS-ADM-24 無料枠モニター：DB 容量はその場で測って記録する
create or replace function public.admin_usage()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  perform private.record_usage();
  insert into public.usage_snapshots (date, metric, value)
  select (now() at time zone 'Asia/Tokyo')::date, 'storage_bytes', coalesce(sum((o.metadata ->> 'size')::bigint), 0) from storage.objects o
  on conflict (date, metric) do update set value = excluded.value;
  return coalesce((select jsonb_agg(to_jsonb(u) order by u.date) from public.usage_snapshots u where u.date > (now() at time zone 'Asia/Tokyo')::date - 30), '[]');
end;
$$;

-- 確認用：使用量を書き換えて逼迫時の動き（重い機能の一時停止）を確かめる
create or replace function public.admin_simulate_usage(p_metric text, p_value bigint, p_paused boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin(array['owner']) then raise exception 'forbidden'; end if;
  insert into public.usage_snapshots (date, metric, value) values ((now() at time zone 'Asia/Tokyo')::date, p_metric, p_value)
  on conflict (date, metric) do update set value = excluded.value;
  update public.app_settings set value = to_jsonb(p_paused), updated_by = auth.uid(), updated_at = now() where key = 'heavy_features_paused';
  perform private.audit(auth.uid(), 'usage.simulate', 'usage', p_metric, null, jsonb_build_object('value', p_value));
end;
$$;

-- A-03 ユーザー検索（閲覧のみの担当者にはメールを伏せる）
create or replace function public.admin_search_users(p_q text default '', p_state text default 'all')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer boolean := private.admin_role() = 'viewer';
begin
  if not private.is_admin(array['owner', 'admin', 'moderator', 'viewer']) then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(x.row order by x.created_at desc) from (
      select p.created_at, jsonb_build_object(
        'profile', private.pub_profile(p),
        'state', private.user_state(p),
        'email', case when v_viewer then private.mask_email(u.email) else u.email end
      ) as row
      from public.profiles p left join auth.users u on u.id = p.id
      where not p.is_official
        and (coalesce(p_q, '') = '' or p.display_name ilike '%' || p_q || '%' or p.handle ilike '%' || p_q || '%' or u.email ilike '%' || p_q || '%' or p.id::text = p_q)
        and (coalesce(p_state, 'all') = 'all' or private.user_state(p) = p_state)
      limit 200
    ) x), '[]');
end;
$$;

-- A-04 ユーザー詳細（メッセージ本文は返さない：ZS-ADM-11）
create or replace function public.admin_user_detail(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p public.profiles;
  v_viewer boolean := private.admin_role() = 'viewer';
begin
  if not private.is_admin(array['owner', 'admin', 'moderator', 'viewer']) then raise exception 'forbidden'; end if;
  select * into v_p from public.profiles where id = p_user;
  if v_p.id is null then raise exception 'not_found' using hint = 'ユーザーが見つかりません'; end if;
  return jsonb_build_object(
    'profile', private.pub_profile(v_p),
    'state', private.user_state(v_p),
    'identities', coalesce((
      select jsonb_agg(jsonb_build_object('kind', case when i.provider = 'email' then 'email' else i.provider end,
        'value', case when v_viewer then private.mask_email(coalesce(i.identity_data ->> 'email', '')) else coalesce(i.identity_data ->> 'email', '') end))
      from auth.identities i where i.user_id = p_user), '[]'),
    'works', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at desc) from public.works w where w.owner_id = p_user), '[]'),
    'stats', jsonb_build_object(
      'messages_sent', (select count(*) from public.messages where sender_id = p_user),
      'likes_given', (select count(*) from public.likes where user_id = p_user),
      'likes_received', (select coalesce(sum(like_count), 0) from public.works where owner_id = p_user),
      'friends', (select count(*) from public.friendships where user_id = p_user)
    ),
    'restrictions', coalesce((select jsonb_agg(to_jsonb(r) order by r.starts_at desc) from public.restrictions r where r.user_id = p_user), '[]'),
    'reports_about', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from public.reports r
      where r.target_id = p_user::text or (r.target_type = 'work' and exists (select 1 from public.works w where w.id::text = r.target_id and w.owner_id = p_user))), '[]'),
    'reports_by', (select count(*) from public.reports where reporter_id = p_user),
    'appeals', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.appeals a where a.user_id = p_user), '[]'),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('user_id', d.user_id, 'device_hash', left(d.device_hash, 12), 'first_seen_at', d.first_seen_at, 'last_seen_at', d.last_seen_at))
      from private.device_hashes d where d.user_id = p_user), '[]'),
    'same_device', coalesce((select jsonb_agg(distinct private.pub_profile(p)) from private.device_hashes a
      join private.device_hashes b on b.device_hash = a.device_hash and b.user_id <> a.user_id
      join public.profiles p on p.id = b.user_id where a.user_id = p_user), '[]'),
    'admin_role', private.admin_role(p_user)
  );
end;
$$;

-- 実行直後の「元に戻す」（15秒以内・永久停止は対象外）
create or replace function public.admin_undo_restrictions(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.restrictions;
begin
  if not private.is_admin(array['owner', 'admin', 'moderator']) then raise exception 'forbidden'; end if;
  for r in select * from public.restrictions where id = any (p_ids) and kind <> 'ban' loop
    if r.created_at < now() - interval '15 seconds' then
      raise exception 'invalid' using hint = '元に戻せる時間を過ぎました。解除を使ってください';
    end if;
    delete from public.restrictions where id = r.id;
    if r.kind = 'freeze' then
      update public.profiles set status = 'active' where id = r.user_id and status = 'frozen';
    end if;
    perform private.official_say(r.user_id, '先ほどの利用制限のお知らせは取り消されました。');
    perform private.audit(auth.uid(), 'restriction.undo', 'user', r.user_id::text, jsonb_build_object('restriction_id', r.id), null);
  end loop;
end;
$$;

-- 重複の疑い（ZS-ADM-12）
create or replace function public.admin_decide_dup(p_id uuid, p_status text, p_decision text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.dup_suspicions;
  v_user uuid;
begin
  if not private.is_admin(array['owner', 'admin', 'moderator']) then raise exception 'forbidden'; end if;
  update public.dup_suspicions set status = p_status, decision = p_decision, decided_by = auth.uid() where id = p_id returning * into v_s;
  if v_s.id is null then raise exception 'not_found'; end if;
  if p_status = 'confirm' then
    foreach v_user in array v_s.user_ids loop
      perform private.official_say(v_user, '複数のアカウントをお持ちでないか確認させてください。zenospace は1人1アカウントでのご利用をお願いしています。このトークにご返信ください。');
    end loop;
  end if;
  perform private.audit(auth.uid(), 'dup.' || p_status, 'dup_suspicion', p_id::text, null, jsonb_build_object('decision', p_decision));
end;
$$;

-- 配信：承認依頼（管理者以上に知らせる）
create or replace function public.admin_request_approval(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.broadcasts;
  v_user uuid;
begin
  if not private.is_admin(array['owner', 'admin', 'publisher']) then raise exception 'forbidden'; end if;
  update public.broadcasts set status = 'pending' where id = p_id and status = 'draft' returning * into v_b;
  if v_b.id is null then raise exception 'invalid_status'; end if;
  for v_user in select user_id from public.admin_members where role in ('owner', 'admin') loop
    perform private.notify(v_user, 'important', auth.uid(), '/admin/broadcasts/' || p_id, '配信「' || coalesce(nullif(v_b.title, ''), '無題') || '」の承認依頼が届きました');
  end loop;
  perform private.audit(auth.uid(), 'broadcast.request_approval', 'broadcast', p_id::text, null, null);
end;
$$;

-- 配信：テスト送信（運営メンバーだけへ。元の配信は下書きのまま）
create or replace function public.admin_test_send(p_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.broadcasts;
  v_new uuid;
begin
  if not private.is_admin(array['owner', 'admin', 'publisher']) then raise exception 'forbidden'; end if;
  select * into v_b from public.broadcasts where id = p_id;
  if v_b.id is null then raise exception 'not_found'; end if;
  if jsonb_array_length(v_b.bubbles) = 0 then raise exception 'empty_broadcast' using hint = '吹き出しを1つ以上追加してください'; end if;
  insert into public.broadcasts (title, kind, status, audience, bubbles, push_text, created_by, approved_by)
  values ('[テスト] ' || v_b.title, v_b.kind, 'draft', 'test', v_b.bubbles, v_b.push_text, auth.uid(), auth.uid())
  returning id into v_new;
  perform private.deliver_broadcast(v_new);
  perform private.audit(auth.uid(), 'broadcast.test', 'broadcast', p_id::text, null, null);
  return (select target_count from public.broadcasts where id = v_new);
end;
$$;

create or replace function public.admin_delete_broadcast(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin(array['owner', 'admin', 'publisher']) then raise exception 'forbidden'; end if;
  delete from public.broadcasts where id = p_id and status <> 'sent';
  if not found then raise exception 'invalid' using hint = '送信済みの配信は削除できません'; end if;
  perform private.audit(auth.uid(), 'broadcast.delete', 'broadcast', p_id::text, null, null);
end;
$$;

-- タグの統合：from を to にまとめる
create or replace function public.admin_merge_tags(p_from text, p_to text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from uuid;
  v_to uuid;
  n int;
begin
  if not private.is_admin(array['owner', 'admin']) then raise exception 'forbidden'; end if;
  select id into v_from from public.tags where normalized_name = lower(btrim(p_from));
  if v_from is null then return 0; end if;
  insert into public.tags (name, normalized_name) values (btrim(p_to), lower(btrim(p_to)))
  on conflict (normalized_name) do update set name = public.tags.name returning id into v_to;
  if v_from = v_to then return 0; end if;
  select count(*) into n from public.work_tags where tag_id = v_from;
  insert into public.work_tags (work_id, tag_id) select work_id, v_to from public.work_tags where tag_id = v_from on conflict do nothing;
  delete from public.work_tags where tag_id = v_from;
  delete from public.tags where id = v_from;
  perform private.audit(auth.uid(), 'master.tags.merge', 'tag', p_from, null, jsonb_build_object('to', p_to, 'works', n));
  return n;
end;
$$;

-- 運営メンバーの役割（オーナーのみ）
create or replace function public.admin_set_member_role(p_handle text, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_before text;
begin
  if not private.is_admin(array['owner']) then raise exception 'forbidden'; end if;
  select id into v_user from public.profiles where lower(handle) = lower(ltrim(btrim(p_handle), '@'));
  if v_user is null then raise exception 'not_found' using hint = 'ユーザーが見つかりません'; end if;
  if v_user = auth.uid() and coalesce(p_role, '') <> 'owner' then raise exception 'forbidden' using hint = '自分のオーナー権限は外せません'; end if;
  v_before := private.admin_role(v_user);
  if p_role is null then
    delete from public.admin_members where user_id = v_user;
  else
    insert into public.admin_members (user_id, role) values (v_user, p_role) on conflict (user_id) do update set role = excluded.role;
  end if;
  perform private.audit(auth.uid(), case when p_role is null then 'admin.role.remove' else 'admin.role.set' end, 'admin_member', v_user::text,
    jsonb_build_object('role', v_before), jsonb_build_object('role', p_role));
end;
$$;

-- システム設定の更新（AIニュースの設定は配信担当も変えられる）
create or replace function public.admin_update_settings(p_values jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  v_news_only boolean := not exists (select 1 from jsonb_object_keys(p_values) x where x <> 'news');
begin
  if not private.is_admin(case when v_news_only then array['owner', 'admin', 'publisher'] else array['owner'] end) then raise exception 'forbidden'; end if;
  for k, v in select * from jsonb_each(p_values) loop
    insert into public.app_settings (key, value, is_public, updated_by, updated_at)
    values (k, v, k in ('invite_only', 'group_max_members', 'upload_max_mb', 'maintenance', 'heavy_features_paused', 'terms_version', 'privacy_version'), auth.uid(), now())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  end loop;
end;
$$;

-- 個人データの出力（オーナーのみ）
create or replace function public.admin_export_user(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin(array['owner']) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.id = p_user),
    'works', coalesce((select jsonb_agg(to_jsonb(w)) from public.works w where w.owner_id = p_user), '[]'),
    'likes', coalesce((select jsonb_agg(to_jsonb(l)) from public.likes l where l.user_id = p_user), '[]'),
    'restrictions', coalesce((select jsonb_agg(to_jsonb(r)) from public.restrictions r where r.user_id = p_user), '[]')
  );
end;
$$;

-- 運営画面で表示名を引く（退会・停止中のユーザーも含む）
create or replace function public.admin_profiles(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.is_admin() then coalesce((select jsonb_agg(private.pub_profile(p)) from public.profiles p where p.id = any (p_ids)), '[]') else '[]'::jsonb end
$$;

-- 配信の削除は RPC だけで行う（送信済みは消せない）。下書きの削除ポリシーは作らない
-- AIニュースの並べ替え・差し替えは news_items の update ポリシー（0003）で行う

-- ---------------------------------------------------------------------------
-- 画像の保存先（Supabase Storage）
-- R2 へ移すまでの間、公開バケット media に保存する。パスの先頭は本人のユーザーID。
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 10485760, array['image/webp', 'image/jpeg', 'image/png', 'image/gif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media: owner can upload" on storage.objects;
create policy "media: owner can upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text and private.is_active_user());
drop policy if exists "media: owner can delete" on storage.objects;
create policy "media: owner can delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 実行権限
-- ---------------------------------------------------------------------------
grant execute on function public.my_state(), public.my_restrictions(), public.my_lock(), public.submit_appeal(uuid, text), public.restore_account(),
  public.agree_terms(), public.issue_invite_code(), public.claim_owner(), public.admin_bootstrap_needed(), public.friend_suggestions(),
  public.my_rooms(), public.mark_read(uuid), public.room_invite_members(uuid, uuid[]), public.room_create_invite(uuid, int, boolean),
  public.room_join_by_invite(text), public.room_approve_join(uuid, uuid, boolean), public.room_set_role(uuid, uuid, text),
  public.room_remove_member(uuid, uuid), public.room_leave(uuid), public.room_dissolve(uuid), public.room_update_group(uuid, text, text),
  public.room_pin_announcement(uuid, bigint, boolean), public.request_respond(uuid, boolean), public.room_reopen(uuid),
  public.save_work(uuid, jsonb), public.work_set_trashed(uuid, boolean),
  public.admin_dashboard(), public.admin_usage(), public.admin_simulate_usage(text, bigint, boolean), public.admin_search_users(text, text),
  public.admin_user_detail(uuid), public.admin_undo_restrictions(uuid[]), public.admin_decide_dup(uuid, text, text), public.admin_request_approval(uuid),
  public.admin_test_send(uuid), public.admin_delete_broadcast(uuid), public.admin_merge_tags(text, text), public.admin_set_member_role(text, text),
  public.admin_update_settings(jsonb), public.admin_export_user(uuid), public.admin_profiles(uuid[])
  to authenticated;
grant execute on function public.profile_stats(uuid), public.featured_creators(), public.room_invite_info(text), public.search_works(jsonb, int, int),
  public.search_facets(jsonb), public.recommended_works(int, int), public.related_works(uuid), public.popular_tags(), public.news_useful_counts(uuid[]),
  public.profile_search_text(text, text, text[])
  to anon, authenticated;
-- 未ログインで呼べてはいけない関数（Supabase は public の関数を既定で anon にも許可するため明示的に外す）
revoke execute on function public.my_state(), public.claim_owner(), public.save_work(uuid, jsonb), public.work_set_trashed(uuid, boolean),
  public.room_join_by_invite(text), public.admin_dashboard(), public.admin_usage(), public.admin_simulate_usage(text, bigint, boolean),
  public.admin_search_users(text, text), public.admin_user_detail(uuid), public.admin_update_settings(jsonb), public.admin_export_user(uuid),
  public.send_message(uuid, text, uuid, text, bigint, jsonb), public.admin_restrict(uuid[], text, timestamptz, text, text, text)
  from anon;
