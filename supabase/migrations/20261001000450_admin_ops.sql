-- =============================================================================
-- zenospace 0004.5: 運営操作（配信・通報・作品・マスタ）と監査ログの自動記録
-- 単純な編集（バナー、情報源、マスタ、設定など）は RLS を通したテーブル更新で行い、
-- 下のトリガーが変更前後を監査ログに残す（ZS-ADM-25）。通知を伴う操作は RPC で行う。
-- =============================================================================

alter table public.broadcasts add column if not exists push_sent_at timestamptz;

-- 運営が編集できるテーブルの変更を監査ログへ（誰が、いつ、何を、変更前後）
create or replace function private.audit_admin_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id text;
begin
  if v_actor is null or private.admin_role(v_actor) is null then
    return coalesce(new, old);
  end if;
  v_id := coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id', to_jsonb(new) ->> 'key', to_jsonb(old) ->> 'key', to_jsonb(new) ->> 'user_id', to_jsonb(old) ->> 'user_id', to_jsonb(new) ->> 'work_id', to_jsonb(old) ->> 'work_id', '');
  perform private.audit(v_actor, tg_table_name || '.' || lower(tg_op), tg_table_name, v_id,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['banners', 'news_sources', 'categories', 'techs', 'tags', 'ng_words', 'app_settings', 'pickups', 'support_templates', 'admin_members', 'broadcasts', 'dup_suspicions'] loop
    execute format('create trigger audit_admin after insert or update or delete on public.%I for each row execute function private.audit_admin_change()', t);
  end loop;
end $$;

-- 配信担当以上は下書きを作成・編集できる（送信は RPC）
create policy broadcasts_write on public.broadcasts for insert
  with check (private.is_admin(array['owner', 'admin', 'publisher']) and status in ('draft', 'pending'));
create policy broadcasts_update on public.broadcasts for update
  using (private.is_admin(array['owner', 'admin', 'publisher']) and status in ('draft', 'pending'))
  with check (status in ('draft', 'pending'));

-- セグメント配信の宛先（ZS-BC-03）。条件は src/lib/types.ts の SegmentQuery と同じ JSON
create or replace function private.segment_users(p_audience text, p_query jsonb)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p
  where not p.is_official and p.deleted_at is null and p.status <> 'banned'
    and (
      p_audience = 'all'
      or (p_audience = 'test' and exists (select 1 from public.admin_members a where a.user_id = p.id))
      or (
        p_audience = 'segment'
        and (p_query ->> 'registeredAfter' is null or p.created_at >= (p_query ->> 'registeredAfter')::timestamptz)
        and (p_query ->> 'registeredBefore' is null or p.created_at <= (p_query ->> 'registeredBefore')::timestamptz)
        and (p_query ->> 'lastLoginWithinDays' is null or p.last_login_at >= now() - make_interval(days => (p_query ->> 'lastLoginWithinDays')::int))
        and (p_query ->> 'hasWorks' is null or (p_query ->> 'hasWorks')::boolean = exists (select 1 from public.works w where w.owner_id = p.id and w.visibility = 'public' and w.status = 'active'))
        and (coalesce(jsonb_array_length(p_query -> 'interests'), 0) = 0 or p.interests && array(select jsonb_array_elements_text(p_query -> 'interests')))
        and (coalesce(jsonb_array_length(p_query -> 'commissionStatus'), 0) = 0 or p.commission_status = any (array(select jsonb_array_elements_text(p_query -> 'commissionStatus'))))
        and (not coalesce((p_query ->> 'testUsersOnly')::boolean, false) or exists (select 1 from public.admin_members a where a.user_id = p.id))
      )
    )
$$;

create or replace function public.admin_estimate_audience(p_audience text, p_query jsonb)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.is_admin(array['owner', 'admin', 'publisher']) then (select count(*)::int from private.segment_users(p_audience, p_query)) else 0 end
$$;

-- 配信の確定。本文は1件のまま、セグメント配信だけ宛先IDを保存する。Push は broadcast-dispatch が 500人ずつ送る
create or replace function private.deliver_broadcast(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.broadcasts;
  v_count int;
begin
  select * into v_b from public.broadcasts where id = p_id for update;
  if v_b.audience <> 'all' then
    insert into public.broadcast_recipients (broadcast_id, user_id)
    select p_id, u from private.segment_users(v_b.audience, v_b.segment_query) u
    on conflict do nothing;
    select count(*) into v_count from public.broadcast_recipients where broadcast_id = p_id;
  else
    select count(*) into v_count from private.segment_users('all', null);
  end if;
  update public.broadcasts set status = 'sent', sent_at = now(), target_count = v_count where id = p_id;
  -- 公式トークの最新表示（全員分の rooms を更新）
  update public.rooms r set last_message_at = now(), last_message_preview = left(coalesce(nullif(v_b.push_text, ''), v_b.title), 80)
  where r.kind = 'official'
    and (v_b.audience = 'all' or exists (select 1 from public.room_members m join public.broadcast_recipients br on br.user_id = m.user_id where m.room_id = r.id and br.broadcast_id = p_id));
end;
$$;

-- ZS-BC-06 承認して送信（予約時刻があれば予約、なければ即時）。ZS-BC-09 通常配信は1日2通まで
create or replace function public.admin_send_broadcast(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.broadcasts;
  v_today int;
  v_need_approval boolean := coalesce((private.setting('broadcast_approval_required'))::boolean, true);
begin
  select * into v_b from public.broadcasts where id = p_id;
  if v_b.id is null then raise exception 'not_found'; end if;
  if v_b.status not in ('draft', 'pending') then raise exception 'invalid_status'; end if;
  if v_need_approval and v_b.audience <> 'test' then
    if not private.is_admin(array['owner', 'admin']) then raise exception 'forbidden' using hint = '承認は管理者以上が行います'; end if;
  elsif not private.is_admin(array['owner', 'admin', 'publisher']) then
    raise exception 'forbidden';
  end if;
  if jsonb_array_length(v_b.bubbles) = 0 then raise exception 'empty_broadcast'; end if;
  if v_b.kind = 'broadcast' and v_b.audience <> 'test' and (v_b.scheduled_at is null or v_b.scheduled_at <= now()) then
    select count(*) into v_today from public.broadcasts
    where kind = 'broadcast' and status = 'sent' and canceled_at is null and audience <> 'test'
      and (sent_at at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date;
    if v_today >= coalesce((private.setting('broadcast_daily_limit'))::int, 2) then
      raise exception 'daily_limit' using hint = '通常配信は1日2通までです';
    end if;
  end if;
  update public.broadcasts set approved_by = auth.uid() where id = p_id;
  if v_b.scheduled_at is not null and v_b.scheduled_at > now() then
    update public.broadcasts set status = 'scheduled' where id = p_id;
    perform private.audit(auth.uid(), 'broadcast.schedule', 'broadcast', p_id::text, null, jsonb_build_object('scheduled_at', v_b.scheduled_at));
    return 'scheduled';
  end if;
  perform private.deliver_broadcast(p_id);
  perform private.audit(auth.uid(), 'broadcast.send', 'broadcast', p_id::text, null, null);
  return 'sent';
end;
$$;

-- 予約時刻が来た配信を確定する（broadcast-dispatch から呼ぶ）
create or replace function private.deliver_due_broadcasts()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  n int := 0;
begin
  for v_id in select id from public.broadcasts where status = 'scheduled' and scheduled_at <= now() order by scheduled_at loop
    perform private.deliver_broadcast(v_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ZS-BC-07 送信後24時間以内の取り消し（全員の画面から消える）／予約の取り消し
create or replace function public.admin_cancel_broadcast(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.broadcasts;
begin
  if not private.is_admin(array['owner', 'admin']) then raise exception 'forbidden'; end if;
  select * into v_b from public.broadcasts where id = p_id;
  if v_b.status = 'scheduled' then
    update public.broadcasts set status = 'draft', scheduled_at = null where id = p_id;
  elsif v_b.status = 'sent' and v_b.sent_at > now() - interval '24 hours' then
    update public.broadcasts set canceled_at = now() where id = p_id;
  else
    raise exception 'cannot_cancel';
  end if;
  perform private.audit(auth.uid(), 'broadcast.cancel', 'broadcast', p_id::text, null, null);
end;
$$;

-- ZS-BC-08 効果測定
create or replace function public.admin_broadcast_report(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not private.is_admin(array['owner', 'admin', 'publisher']) then null else jsonb_build_object(
    'target', b.target_count,
    'push_delivered', b.push_delivered,
    'reads', (select count(distinct user_id) from public.broadcast_events e where e.broadcast_id = b.id and e.kind = 'read'),
    'clickers', (select count(distinct user_id) from public.broadcast_events e where e.broadcast_id = b.id and e.kind = 'click'),
    'buttons', coalesce((select jsonb_object_agg(button_key, n) from (select button_key, count(*) n from public.broadcast_events e where e.broadcast_id = b.id and e.kind = 'click' group by button_key) x), '{}')
  ) end
  from public.broadcasts b where b.id = p_id
$$;

-- AIニュースの承認（14.11）：配信時刻より前なら予約、過ぎていれば ai-news の deliver が即時に送る
create or replace function public.admin_approve_news(p_digest uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin(array['owner', 'admin', 'publisher']) then raise exception 'forbidden'; end if;
  update public.news_digests set status = 'approved', approved_by = auth.uid() where id = p_digest and status = 'pending';
  if not found then raise exception 'invalid_status'; end if;
  perform private.audit(auth.uid(), 'news.approve', 'news_digest', p_digest::text, null, null);
end;
$$;

-- ZS-ADM-13〜16 通報の対応。対応済みにしたら通報者に「対応しました」とだけ知らせる
create or replace function public.admin_update_report(p_id uuid, p_status text, p_assignee uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.reports;
begin
  if not private.is_admin(array['owner', 'admin', 'moderator']) then raise exception 'forbidden'; end if;
  select * into v_r from public.reports where id = p_id;
  update public.reports
  set status = p_status,
      assignee_id = coalesce(p_assignee, assignee_id),
      first_action_at = coalesce(first_action_at, now()),
      resolved_at = case when p_status in ('resolved', 'rejected') then now() else resolved_at end
  where id = p_id;
  if p_status = 'resolved' and v_r.status <> 'resolved' then
    perform private.notify(v_r.reporter_id, 'important', null, '/notifications', 'ご報告いただいた内容を確認し、対応しました。ご協力ありがとうございます');
  end if;
  perform private.audit(auth.uid(), 'report.update', 'report', p_id::text, jsonb_build_object('status', v_r.status), jsonb_build_object('status', p_status, 'assignee', p_assignee));
end;
$$;

-- ZS-ADM-17 作品の非公開化（本人に理由を知らせる）
create or replace function public.admin_set_work_hidden(p_work uuid, p_hidden boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_w public.works;
begin
  if not private.is_admin(array['owner', 'admin', 'moderator']) then raise exception 'forbidden'; end if;
  update public.works set status = case when p_hidden then 'hidden' else 'active' end, hidden_reason = case when p_hidden then coalesce(nullif(p_reason, ''), '運営の判断により非公開にしました') end
  where id = p_work returning * into v_w;
  perform private.official_say(v_w.owner_id, case when p_hidden then '作品「' || v_w.title || '」を非公開にしました。理由：' || v_w.hidden_reason else '作品「' || v_w.title || '」の非公開を解除しました。' end);
  perform private.audit(auth.uid(), case when p_hidden then 'work.hide' else 'work.unhide' end, 'work', p_work::text, null, jsonb_build_object('reason', p_reason));
end;
$$;

-- ZS-ADM-07 異議申し立ての判断
create or replace function public.admin_decide_appeal(p_id uuid, p_decision text, p_result text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.appeals;
begin
  if not private.is_admin(array['owner', 'admin', 'moderator']) then raise exception 'forbidden'; end if;
  update public.appeals set status = p_decision, decided_by = auth.uid(), result = p_result where id = p_id returning * into v_a;
  if p_decision = 'lifted' then
    perform public.admin_lift_restriction(v_a.restriction_id, '異議申し立てにより解除');
  end if;
  if p_decision in ('lifted', 'kept') then
    perform private.official_say(v_a.user_id, case when p_decision = 'lifted' then '異議申し立てを確認し、制限を解除しました。' else '異議申し立てを確認しましたが、制限を維持します。' || coalesce(E'\n' || nullif(p_result, ''), '') end);
  end if;
  perform private.audit(auth.uid(), 'appeal.' || p_decision, 'appeal', p_id::text, null, jsonb_build_object('result', p_result));
end;
$$;

-- サポート受信箱からの返信（ZS-OFC-04）。表示名は「運営チーム」、担当者名は任意
create or replace function public.admin_support_reply(p_room uuid, p_body text, p_sign_name text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not private.is_admin(array['owner', 'admin', 'moderator', 'publisher']) then raise exception 'forbidden'; end if;
  select user_id into v_user from public.support_threads where room_id = p_room;
  if v_user is null then raise exception 'not_found'; end if;
  perform private.official_say(v_user, p_body, false, p_sign_name);
  perform private.notify(v_user, 'message', private.official_id(), '/talk/' || p_room, '運営チーム「' || left(p_body, 40) || '」');
  update public.support_threads set status = 'pending', assignee_id = coalesce(assignee_id, auth.uid()) where room_id = p_room;
  perform private.audit(auth.uid(), 'support.reply', 'support_thread', p_room::text, null, null);
end;
$$;

-- 公式アカウント宛てのメッセージは運営が閲覧できる（19.1 の例外）。それ以外のトーク本文は見られない
create policy messages_support_admin on public.messages for select
  using (private.room_kind(room_id) = 'official' and private.is_admin(array['owner', 'admin', 'moderator', 'publisher']));

-- Edge Function（service_role）から配信を確定する（AIニュースの配信など）
create or replace function public.service_deliver_broadcast(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  perform private.deliver_broadcast(p_id);
end;
$$;
revoke execute on function public.service_deliver_broadcast(uuid) from anon, authenticated;
grant execute on function public.service_deliver_broadcast(uuid) to service_role;

grant execute on function public.admin_estimate_audience(text, jsonb), public.admin_send_broadcast(uuid), public.admin_cancel_broadcast(uuid),
  public.admin_broadcast_report(uuid), public.admin_approve_news(uuid), public.admin_update_report(uuid, text, uuid),
  public.admin_set_work_hidden(uuid, boolean, text), public.admin_decide_appeal(uuid, text, text), public.admin_support_reply(uuid, text, text)
  to authenticated;
