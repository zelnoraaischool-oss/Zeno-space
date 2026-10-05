-- =============================================================================
-- zenospace 0006: Realtime（プライベートチャンネル：18.3）
-- 参加者だけが購読できるチャンネル `room:{room_id}` でメッセージと既読を配信する。
-- 新着は接続中の宛先にだけ届け、オフラインの人には Web Push で知らせる（16.5）。
-- =============================================================================

-- 購読・送信の認可：チャンネル名が room:{id} のとき、そのルームの参加者だけ
create policy "room members can receive" on realtime.messages for select to authenticated
  using (
    realtime.topic() like 'room:%'
    and private.is_room_member((split_part(realtime.topic(), ':', 2))::uuid)
  );
create policy "room members can send typing/read" on realtime.messages for insert to authenticated
  with check (
    realtime.topic() like 'room:%'
    and private.is_room_member((split_part(realtime.topic(), ':', 2))::uuid)
    and extension in ('broadcast')
  );
-- 本人あての通知（制限の即時反映 ZS-ADM-02 など）は user:{id}
create policy "user can receive own channel" on realtime.messages for select to authenticated
  using (realtime.topic() = 'user:' || auth.uid()::text);

-- メッセージの insert / update をルームのチャンネルへ流す
create or replace function private.broadcast_message_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.broadcast_changes('room:' || new.room_id::text, tg_op, tg_op, tg_table_name, tg_table_schema, new, old);
  return null;
end;
$$;
create trigger messages_broadcast after insert or update on public.messages for each row execute function private.broadcast_message_change();

-- 制限の追加・解除を本人のチャンネルへ流す（入力欄の無効化と制限バナー：ZS-ADM-02）
create or replace function private.broadcast_restriction_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(jsonb_build_object('kind', new.kind, 'lifted', new.lifted_at is not null), 'restriction', 'user:' || new.user_id::text, true);
  return null;
end;
$$;
create trigger restrictions_broadcast after insert or update on public.restrictions for each row execute function private.broadcast_restriction_change();
