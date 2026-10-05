-- =============================================================================
-- zenospace 0003: 権限（行レベルセキュリティ）
-- 18.3：全テーブルで RLS を有効にし、既定は拒否。メッセージはルームの参加者だけが読める。
-- ZS-ADM-03：制限中の送信は RLS とサーバー関数で拒否する（画面を経由しない送信も拒否）。
-- 運営は TOTP 済み（JWT の aal = aal2）のセッションでだけ運営権限を持つ。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 判定用の関数（security definer で RLS の再帰を避ける）
-- ---------------------------------------------------------------------------
create or replace function private.is_room_member(p_room uuid, p_user uuid default auth.uid(), p_active_only boolean default true)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = p_room and m.user_id = p_user
      and (case when p_active_only then m.state = 'active' else m.state <> 'left' end)
  )
$$;

-- 有効な制限があるか（ZS-ADM-03）
create or replace function private.has_restriction(p_user uuid, p_kinds text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.restrictions r
    where r.user_id = p_user
      and r.kind = any (p_kinds)
      and r.lifted_at is null
      and r.starts_at <= now()
      and (r.ends_at is null or r.ends_at > now())
  )
$$;

create or replace function private.admin_role(p_user uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.admin_members where user_id = p_user
$$;

-- 3.2 運営ロールと権限。TOTP 済み（aal2）のセッションに限る
create or replace function private.is_admin(p_roles text[] default array['owner', 'admin', 'moderator', 'publisher', 'viewer'])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.admin_role() = any (p_roles), false)
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create or replace function private.blocked(p_blocker uuid, p_blocked uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.blocks where blocker_id = p_blocker and blocked_id = p_blocked)
$$;

create or replace function private.room_kind(p_room uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select kind from public.rooms where id = p_room
$$;

create or replace function private.is_active_user(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = p_user and status = 'active' and deleted_at is null)
     and not private.has_restriction(p_user, array['freeze', 'ban'])
$$;

grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS を有効化（既定は拒否）
-- ---------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
  for t in select tablename from pg_tables where schemaname = 'private' loop
    execute format('alter table private.%I enable row level security', t.tablename);
  end loop;
end $$;

-- private のテーブルはクライアントから一切触れない（サーバー関数だけが使う）
revoke all on all tables in schema private from anon, authenticated;

-- ---------------------------------------------------------------------------
-- アカウント・つながり
-- ---------------------------------------------------------------------------
-- 未ログインでも公開プロフィールは見られる（13.1）。ブロックした相手は見られない（ZS-SOC-04）
create policy profiles_select on public.profiles for select
  using (
    deleted_at is null
    and status <> 'banned'
    and (profile_visibility = 'public' or auth.uid() is not null)
    and (auth.uid() is null or not private.blocked(id, auth.uid()))
    or id = auth.uid()
    or private.is_admin(array['owner', 'admin', 'moderator', 'viewer'])
  );
-- 本人は自分の行だけ更新できる。status / is_official などは列権限で更新させない
create policy profiles_update_own on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_key, avatar_color, cover_key, bio, skills, links, prefecture, commission_status, dm_policy, profile_visibility, interests, onboarded) on public.profiles to authenticated;

create policy consents_own on public.consents for select using (user_id = auth.uid());
create policy consents_insert on public.consents for insert with check (user_id = auth.uid());

create policy user_settings_own on public.user_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy friendships_select on public.friendships for select using (user_id = auth.uid() or friend_id = auth.uid());
-- 友だち追加：「新規トーク開始の停止」中は不可、ブロック関係があれば不可
create policy friendships_insert on public.friendships for insert
  with check (
    user_id = auth.uid()
    and private.is_active_user()
    and not private.has_restriction(auth.uid(), array['new_talk'])
    and not private.blocked(friend_id, auth.uid())
    and not private.blocked(auth.uid(), friend_id)
  );
create policy friendships_update on public.friendships for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy friendships_delete on public.friendships for delete using (user_id = auth.uid());

create policy blocks_own on public.blocks for all using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

create policy invite_codes_own on public.invite_codes for select using (issued_by = auth.uid() or private.is_admin(array['owner', 'admin']));

-- ---------------------------------------------------------------------------
-- チャット（作成・送信・既読などの書き込みは主に RPC で行う：0004）
-- ---------------------------------------------------------------------------
-- 公式アカウントとのトークは「チャット利用停止」でも見られる
create policy rooms_select on public.rooms for select
  using (
    private.is_room_member(id, auth.uid(), false)
    and (kind = 'official' or not private.has_restriction(auth.uid(), array['chat_all']))
  );

create policy room_members_select on public.room_members for select
  using (user_id = auth.uid() or private.is_room_member(room_id));
-- 自分の行の既読・通知・ピン留め・非表示だけ更新できる（列権限で絞る）
create policy room_members_update_own on public.room_members for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.room_members from authenticated;
grant update (last_read_at, notify_level, pinned_at, hidden_at) on public.room_members to authenticated;

create policy messages_select on public.messages for select
  using (
    private.is_room_member(room_id)
    and (private.room_kind(room_id) = 'official' or not private.has_restriction(auth.uid(), array['chat_all']))
    and not exists (select 1 from public.message_hides h where h.message_id = messages.id and h.user_id = auth.uid())
    and not exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = messages.sender_id and messages.created_at >= b.created_at)
  );
-- 直接の insert も制限を強制する（通常は send_message RPC を使う）
create policy messages_insert on public.messages for insert
  with check (
    sender_id = auth.uid()
    and kind <> 'system'
    and private.is_active_user()
    and private.is_room_member(room_id, auth.uid(), false)
    and (
      private.room_kind(room_id) = 'official'
      or not private.has_restriction(auth.uid(), array['chat_send', 'chat_all'])
    )
  );

create policy message_hides_own on public.message_hides for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy reactions_select on public.reactions for select
  using (exists (select 1 from public.messages m where m.id = message_id and private.is_room_member(m.room_id)));
create policy reactions_write on public.reactions for insert
  with check (
    user_id = auth.uid()
    and not private.has_restriction(auth.uid(), array['chat_send', 'chat_all', 'freeze', 'ban'])
    and exists (select 1 from public.messages m where m.id = message_id and private.is_room_member(m.room_id))
  );
create policy reactions_delete on public.reactions for delete using (user_id = auth.uid());

create policy attachments_select on public.attachments for select
  using (exists (select 1 from public.messages m where m.id = message_id and private.is_room_member(m.room_id)));

create policy room_announcements_select on public.room_announcements for select using (private.is_room_member(room_id));
create policy room_invites_select on public.room_invites for select using (private.is_room_member(room_id));

create policy inquiries_select on public.inquiries for select using (from_user = auth.uid() or to_user = auth.uid());

-- ---------------------------------------------------------------------------
-- ショーケース
-- ---------------------------------------------------------------------------
create policy categories_read on public.categories for select using (true);
create policy techs_read on public.techs for select using (true);
create policy tags_read on public.tags for select using (true);
create policy masters_admin_cat on public.categories for all using (private.is_admin(array['owner', 'admin'])) with check (private.is_admin(array['owner', 'admin']));
create policy masters_admin_tech on public.techs for all using (private.is_admin(array['owner', 'admin'])) with check (private.is_admin(array['owner', 'admin']));
create policy masters_admin_tag on public.tags for all using (private.is_admin(array['owner', 'admin'])) with check (private.is_admin(array['owner', 'admin']));

-- 公開・限定公開（URLを知る人）の作品は誰でも見られる。下書きと非公開化は本人のみ
create policy works_select on public.works for select
  using (
    owner_id = auth.uid()
    or (
      status = 'active' and visibility in ('public', 'unlisted') and deleted_at is null
      and exists (select 1 from public.profiles p where p.id = owner_id and p.status <> 'banned' and p.deleted_at is null)
      and (auth.uid() is null or not private.blocked(owner_id, auth.uid()))
    )
    or private.is_admin(array['owner', 'admin', 'moderator', 'publisher', 'viewer'])
  );
-- 作品投稿停止中は投稿と編集ができない
create policy works_insert on public.works for insert
  with check (owner_id = auth.uid() and private.is_active_user() and not private.has_restriction(auth.uid(), array['post']));
create policy works_update on public.works for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and not private.has_restriction(auth.uid(), array['post']));
-- 集計値・status は本人に更新させない
revoke update on public.works from authenticated;
grant update (type, title, catch_copy, description, category_id, production_type, roles, period_value, period_unit, price_min, price_max, url, store_url, video_url, visibility, license_confirmed, published_at, deleted_at) on public.works to authenticated;

create policy work_media_select on public.work_media for select using (exists (select 1 from public.works w where w.id = work_id));
create policy work_media_write on public.work_media for all
  using (exists (select 1 from public.works w where w.id = work_id and w.owner_id = auth.uid()))
  with check (exists (select 1 from public.works w where w.id = work_id and w.owner_id = auth.uid()) and not private.has_restriction(auth.uid(), array['post']));
create policy work_techs_select on public.work_techs for select using (exists (select 1 from public.works w where w.id = work_id));
create policy work_techs_write on public.work_techs for all
  using (exists (select 1 from public.works w where w.id = work_id and w.owner_id = auth.uid()))
  with check (exists (select 1 from public.works w where w.id = work_id and w.owner_id = auth.uid()));
create policy work_tags_select on public.work_tags for select using (exists (select 1 from public.works w where w.id = work_id));
create policy work_tags_write on public.work_tags for all
  using (exists (select 1 from public.works w where w.id = work_id and w.owner_id = auth.uid()))
  with check (exists (select 1 from public.works w where w.id = work_id and w.owner_id = auth.uid()));

create policy likes_own on public.likes for select using (user_id = auth.uid());
create policy likes_insert on public.likes for insert with check (user_id = auth.uid() and private.is_active_user());
create policy likes_delete on public.likes for delete using (user_id = auth.uid());

create policy collections_own on public.collections for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy collection_items_own on public.collection_items for all
  using (exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid()));
create policy view_history_own on public.view_history for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy saved_searches_own on public.saved_searches for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- インサイトは作品の持ち主だけ
create policy work_daily_stats_owner on public.work_daily_stats for select
  using (exists (select 1 from public.works w where w.id = work_id and w.owner_id = auth.uid()) or private.is_admin());

create policy pickups_read on public.pickups for select using (true);
create policy pickups_admin on public.pickups for all using (private.is_admin(array['owner', 'admin', 'publisher'])) with check (private.is_admin(array['owner', 'admin', 'publisher']));

-- ---------------------------------------------------------------------------
-- 通知・配信・AIニュース
-- ---------------------------------------------------------------------------
create policy notifications_own on public.notifications for select using (user_id = auth.uid());
create policy notifications_read on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy push_subscriptions_own on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 配信本文は official_feed() RPC 経由で読む。テーブルは運営だけ
create policy broadcasts_admin on public.broadcasts for select using (private.is_admin(array['owner', 'admin', 'publisher']));
create policy broadcast_recipients_admin on public.broadcast_recipients for select using (private.is_admin(array['owner', 'admin', 'publisher']));
create policy broadcast_events_insert on public.broadcast_events for insert with check (user_id = auth.uid());
create policy broadcast_events_admin on public.broadcast_events for select using (private.is_admin(array['owner', 'admin', 'publisher']));

create policy banners_read on public.banners for select using (starts_at <= now() and ends_at > now() or private.is_admin(array['owner', 'admin', 'publisher']));
create policy banners_admin on public.banners for all using (private.is_admin(array['owner', 'admin', 'publisher'])) with check (private.is_admin(array['owner', 'admin', 'publisher']));
create policy banner_dismissals_own on public.banner_dismissals for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy news_digests_read on public.news_digests for select using (status = 'sent' or private.is_admin(array['owner', 'admin', 'publisher']));
create policy news_digests_admin on public.news_digests for update using (private.is_admin(array['owner', 'admin', 'publisher']));
create policy news_items_read on public.news_items for select
  using (exists (select 1 from public.news_digests d where d.id = digest_id and d.status = 'sent') or private.is_admin(array['owner', 'admin', 'publisher']));
create policy news_items_admin on public.news_items for update using (private.is_admin(array['owner', 'admin', 'publisher']));
create policy news_sources_admin on public.news_sources for all using (private.is_admin(array['owner', 'admin', 'publisher'])) with check (private.is_admin(array['owner', 'admin', 'publisher']));
create policy news_sources_read on public.news_sources for select using (true);
create policy news_reactions_own on public.news_reactions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 運営
-- ---------------------------------------------------------------------------
create policy admin_members_read on public.admin_members for select using (user_id = auth.uid() or private.is_admin());
create policy admin_members_owner on public.admin_members for all using (private.is_admin(array['owner'])) with check (private.is_admin(array['owner']));

-- 本人は自分の制限を見られる（理由と期限を画面に出すため）。社内メモは view で隠す
create policy restrictions_read on public.restrictions for select
  using (user_id = auth.uid() or private.is_admin(array['owner', 'admin', 'moderator', 'viewer']));

create policy appeals_own on public.appeals for select using (user_id = auth.uid() or private.is_admin(array['owner', 'admin', 'moderator']));
create policy appeals_insert on public.appeals for insert
  with check (user_id = auth.uid() and exists (select 1 from public.restrictions r where r.id = restriction_id and r.user_id = auth.uid()));
create policy appeals_admin on public.appeals for update using (private.is_admin(array['owner', 'admin', 'moderator']));

create policy reports_insert on public.reports for insert with check (reporter_id = auth.uid() and private.is_active_user());
create policy reports_read on public.reports for select using (reporter_id = auth.uid() or private.is_admin(array['owner', 'admin', 'moderator']));
create policy reports_admin on public.reports for update using (private.is_admin(array['owner', 'admin', 'moderator']));

create policy dup_suspicions_admin on public.dup_suspicions for all using (private.is_admin(array['owner', 'admin', 'moderator', 'viewer'])) with check (private.is_admin(array['owner', 'admin', 'moderator']));
create policy support_threads_admin on public.support_threads for all using (private.is_admin(array['owner', 'admin', 'moderator', 'publisher'])) with check (private.is_admin(array['owner', 'admin', 'moderator', 'publisher']));
create policy support_templates_admin on public.support_templates for all using (private.is_admin(array['owner', 'admin', 'moderator', 'publisher'])) with check (private.is_admin(array['owner', 'admin']));
-- NG ワードは端末内で照合するため、ログインユーザーは読める（19.1）
create policy ng_words_read on public.ng_words for select using (auth.uid() is not null);
create policy ng_words_admin on public.ng_words for all using (private.is_admin(array['owner', 'admin'])) with check (private.is_admin(array['owner', 'admin']));

-- 監査ログ：閲覧はオーナー・管理者のみ。insert/update/delete のポリシーは作らない（関数からのみ追記）
create policy audit_logs_read on public.audit_logs for select using (private.is_admin(array['owner', 'admin']));
revoke insert, update, delete, truncate on public.audit_logs from anon, authenticated, service_role;

create policy app_settings_public on public.app_settings for select using (is_public or private.is_admin());
create policy app_settings_owner on public.app_settings for all using (private.is_admin(array['owner'])) with check (private.is_admin(array['owner']));

create policy usage_snapshots_admin on public.usage_snapshots for select using (private.is_admin());

-- 本人向けの制限ビュー（社内メモを出さない）
create view public.my_restrictions with (security_invoker = true) as
  select id, kind, starts_at, ends_at, reason_category, user_message, lifted_at
  from public.restrictions
  where user_id = auth.uid() and lifted_at is null and starts_at <= now() and (ends_at is null or ends_at > now());
grant select on public.my_restrictions to authenticated;
