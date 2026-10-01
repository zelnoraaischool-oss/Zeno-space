-- =============================================================================
-- zenospace 0002: テーブル定義（16.3）
-- 画像とファイルの実体は Cloudflare R2 に置き、DB には保存キーとサイズだけを持つ。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- アカウント・つながり
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade, -- 認証IDと同じ（1人1行）
  handle text not null,
  display_name text not null check (char_length(display_name) between 1 and 20),
  avatar_key text,
  avatar_color text not null default '#6A4DF5',
  cover_key text,
  bio text not null default '' check (char_length(bio) <= 160),
  skills text[] not null default '{}' check (cardinality(skills) <= 10),
  links text[] not null default '{}' check (cardinality(links) <= 5),
  prefecture text,
  commission_status text not null default 'consult' check (commission_status in ('open', 'consult', 'closed')),
  dm_policy text not null default 'everyone' check (dm_policy in ('everyone', 'friends', 'inquiry')),
  profile_visibility text not null default 'public' check (profile_visibility in ('public', 'members')),
  interests text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'frozen', 'banned', 'leaving')),
  is_official boolean not null default false,
  birth_ym text check (birth_ym ~ '^\d{4}-\d{2}$'),
  handle_changed_at timestamptz,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint profiles_handle_format check (handle ~ '^[A-Za-z0-9_]{4,20}$')
);
create unique index profiles_handle_key on public.profiles (lower(handle));
create trigger profiles_updated_at before update on public.profiles for each row execute function private.set_updated_at();

-- 1人1アカウントの判定（ZS-ONE-01/02）。正規化したメールと外部IDのハッシュ
create table private.identity_keys (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('email', 'google', 'github')),
  value_hash text not null,
  created_at timestamptz not null default now(),
  primary key (kind, value_hash)
);
create index identity_keys_user_idx on private.identity_keys (user_id);
create unique index identity_keys_email_key on private.identity_keys (value_hash) where kind = 'email';

-- 永久停止で再登録を止める識別子（ハッシュのみ）
create table private.banned_identities (
  value_hash text primary key,
  created_at timestamptz not null default now()
);

-- ZS-ONE-03 同じ端末からの複数登録を検知する（最終利用から1年で削除）
create table private.device_hashes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  device_hash text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_hash)
);
create index device_hashes_hash_idx on private.device_hashes (device_hash);

-- ZS-AUTH-06 規約同意の記録
create table public.consents (
  user_id uuid not null references public.profiles (id) on delete cascade,
  doc text not null check (doc in ('terms', 'privacy')),
  version text not null,
  agreed_at timestamptz not null default now(),
  primary key (user_id, doc, version)
);

create table public.user_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  notify jsonb not null default '{"message":true,"mention":true,"request":true,"friend":true,"like":true,"inquiry":true,"saved_search":true,"broadcast":true,"news":true,"important":true}',
  quiet_hours jsonb not null default '{"enabled":false,"start":"23:00","end":"07:00"}',
  hide_push_body boolean not null default false,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  text_size text not null default 'normal' check (text_size in ('normal', 'large', 'xlarge')),
  reduce_motion boolean not null default false,
  enter_to_send boolean not null default true,
  updated_at timestamptz not null default now()
);
create trigger user_settings_updated_at before update on public.user_settings for each row execute function private.set_updated_at();

-- 一方向の追加。相互かどうかは双方の行で判定する
create table public.friendships (
  user_id uuid not null references public.profiles (id) on delete cascade,
  friend_id uuid not null references public.profiles (id) on delete cascade,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create index friendships_friend_idx on public.friendships (friend_id);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

-- 招待制モード用（ZS-ONE-05）
create table public.invite_codes (
  code text primary key,
  issued_by uuid not null references public.profiles (id) on delete cascade,
  used_by uuid references public.profiles (id) on delete set null,
  used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ショーケース（チャットより先に作る：rooms.work_id が参照するため）
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null unique,
  sort_order int not null default 0
);
create table public.techs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null unique,
  sort_order int not null default 0
);
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null unique,
  sort_order int not null default 0
);

create table public.works (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('hp', 'lp', 'app', 'image', 'video', 'other')),
  title text not null default '' check (char_length(title) <= 40),
  catch_copy text not null default '' check (char_length(catch_copy) <= 60),
  description text not null default '' check (char_length(description) <= 2000),
  category_id uuid references public.categories (id),
  production_type text check (production_type in ('client', 'personal', 'study')),
  roles text[] not null default '{}',
  period_value int check (period_value > 0),
  period_unit text check (period_unit in ('day', 'week', 'month')),
  price_min int check (price_min >= 0),
  price_max int check (price_max >= 0),
  url text not null default '',
  store_url text not null default '',
  video_url text not null default '',
  visibility text not null default 'draft' check (visibility in ('public', 'unlisted', 'draft')),
  license_confirmed boolean not null default false,
  status text not null default 'active' check (status in ('active', 'hidden', 'trashed')),
  hidden_reason text,
  -- 集計値のキャッシュ（トリガーで更新し、夜間に実数と照合して補正する）
  like_count int not null default 0,
  view_count int not null default 0,
  inquiry_count int not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- 実案件はクライアントの掲載許諾が必須（ZS-WORK-04）
  constraint works_license check (visibility = 'draft' or production_type is distinct from 'client' or license_confirmed),
  constraint works_price check (price_min is null or price_max is null or price_min <= price_max)
);
create index works_owner_idx on public.works (owner_id);
create index works_public_new_idx on public.works (published_at desc) where status = 'active' and visibility = 'public';
create index works_category_idx on public.works (category_id);
create trigger works_updated_at before update on public.works for each row execute function private.set_updated_at();

-- 3サイズの画像は同じキーの接尾辞（_400 / _1200 / _2048）で区別する
create table public.work_media (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.works (id) on delete cascade,
  storage_key text not null,
  width int not null,
  height int not null,
  bytes int not null default 0,
  sort_order int not null default 0,
  alt_text text not null default '',
  dominant_color text not null default '#1C2038'
);
create index work_media_work_idx on public.work_media (work_id, sort_order);

create table public.work_techs (
  work_id uuid not null references public.works (id) on delete cascade,
  tech_id uuid not null references public.techs (id) on delete restrict,
  primary key (work_id, tech_id)
);
create table public.work_tags (
  work_id uuid not null references public.works (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete restrict,
  primary key (work_id, tag_id)
);
create index work_tags_tag_idx on public.work_tags (tag_id);

create table public.likes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  work_id uuid not null references public.works (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, work_id)
);
create index likes_work_idx on public.likes (work_id, created_at desc);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  created_at timestamptz not null default now()
);
create table public.collection_items (
  collection_id uuid not null references public.collections (id) on delete cascade,
  work_id uuid not null references public.works (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (collection_id, work_id)
);

-- 1人100件まで（トリガーで古い順に削除）
create table public.view_history (
  user_id uuid not null references public.profiles (id) on delete cascade,
  work_id uuid not null references public.works (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, work_id)
);
create index view_history_user_idx on public.view_history (user_id, viewed_at desc);

create table public.work_daily_stats (
  work_id uuid not null references public.works (id) on delete cascade,
  date date not null,
  views int not null default 0,
  likes int not null default 0,
  inquiries int not null default 0,
  primary key (work_id, date)
);

create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  query jsonb not null,
  notify boolean not null default true,
  last_notified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.pickups (
  work_id uuid primary key references public.works (id) on delete cascade,
  sort_order int not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- チャット
-- ---------------------------------------------------------------------------
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group', 'inquiry', 'official')),
  name text check (char_length(name) <= 50),
  icon_key text,
  icon_color text not null default '#22D3EE',
  owner_id uuid references public.profiles (id) on delete set null,
  work_id uuid references public.works (id) on delete set null,
  direct_key text unique, -- 1:1 は2人の組で一意（小さいID:大きいID）
  last_message_at timestamptz not null default now(),
  last_message_preview text not null default '',
  member_count int not null default 0,
  created_at timestamptz not null default now()
);
create index rooms_last_message_idx on public.rooms (last_message_at desc);

create table public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  state text not null default 'active' check (state in ('active', 'request', 'left')),
  last_read_at timestamptz not null default now(), -- ここから「既読 N」を計算する
  notify_level text not null default 'all' check (notify_level in ('all', 'mention', 'off')),
  pinned_at timestamptz,
  hidden_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index room_members_user_idx on public.room_members (user_id, state);

create table public.messages (
  id bigint generated always as identity primary key, -- 並び順と容量を優先して連番
  room_id uuid not null references public.rooms (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'image', 'file', 'work', 'link', 'system', 'rich')),
  body text not null default '' check (char_length(body) <= 2000),
  reply_to_id bigint references public.messages (id) on delete set null,
  meta jsonb not null default '{}',
  client_id uuid not null unique, -- オフライン再送の二重登録を防ぐ
  created_at timestamptz not null default now(),
  unsent_at timestamptz
);
create index messages_room_idx on public.messages (room_id, id desc);
create index messages_sender_idx on public.messages (sender_id, created_at desc);

-- 自分側のみ削除（ZS-CHAT-21）
create table public.message_hides (
  user_id uuid not null references public.profiles (id) on delete cascade,
  message_id bigint not null references public.messages (id) on delete cascade,
  primary key (user_id, message_id)
);

-- 1人1メッセージにつき1つ
create table public.reactions (
  message_id bigint not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('like', 'heart', 'laugh', 'wow', 'sad', 'thanks')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- 90日で削除（ZS-CHAT-12）
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  message_id bigint not null references public.messages (id) on delete cascade,
  storage_key text not null,
  mime text not null,
  size int not null,
  width int,
  height int,
  expires_at timestamptz
);
create index attachments_message_idx on public.attachments (message_id);

create table public.room_invites (
  token text primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  expires_at timestamptz,
  requires_approval boolean not null default false,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- 最大3件
create table public.room_announcements (
  room_id uuid not null references public.rooms (id) on delete cascade,
  message_id bigint not null references public.messages (id) on delete cascade,
  pinned_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (room_id, message_id)
);

-- 平均返信時間の計算に使う（ZS-INQ-04）
create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null unique references public.rooms (id) on delete cascade,
  work_id uuid references public.works (id) on delete set null,
  from_user uuid not null references public.profiles (id) on delete cascade,
  to_user uuid not null references public.profiles (id) on delete cascade,
  template text,
  created_at timestamptz not null default now(),
  first_reply_at timestamptz,
  unique (work_id, from_user)
);
create index inquiries_to_idx on public.inquiries (to_user);

-- ---------------------------------------------------------------------------
-- 通知・配信・AIニュース
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('message', 'mention', 'request', 'friend', 'like', 'inquiry', 'saved_search', 'broadcast', 'news', 'important')),
  actor_id uuid references public.profiles (id) on delete set null,
  target text not null,
  text text not null,
  grouped_count int not null default 1,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- 失効の応答（410）を受けたら削除する
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,
  user_agent text not null default '',
  failure_count int not null default 0,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- 本文は1件だけ保存する（宛先ごとに複製しない：9.2）
create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  kind text not null default 'broadcast' check (kind in ('broadcast', 'news', 'important')),
  status text not null default 'draft' check (status in ('draft', 'pending', 'scheduled', 'sent', 'canceled')),
  audience text not null default 'all' check (audience in ('all', 'segment', 'test')),
  segment_query jsonb,
  bubbles jsonb not null default '[]' check (jsonb_array_length(bubbles) <= 5),
  push_text text not null default '' check (char_length(push_text) <= 60),
  scheduled_at timestamptz,
  sent_at timestamptz,
  canceled_at timestamptz,
  target_count int not null default 0,
  push_delivered int not null default 0,
  created_by uuid references public.profiles (id),
  approved_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index broadcasts_sent_idx on public.broadcasts (sent_at desc) where status = 'sent' and canceled_at is null;
create index broadcasts_scheduled_idx on public.broadcasts (scheduled_at) where status = 'scheduled';

-- セグメント配信の宛先IDだけを保存する
create table public.broadcast_recipients (
  broadcast_id uuid not null references public.broadcasts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (broadcast_id, user_id)
);
create index broadcast_recipients_user_idx on public.broadcast_recipients (user_id);

-- 開封とタップの計測
create table public.broadcast_events (
  id bigint generated always as identity primary key,
  broadcast_id uuid not null references public.broadcasts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('read', 'click')),
  button_key text,
  created_at timestamptz not null default now()
);
create unique index broadcast_events_read_once on public.broadcast_events (broadcast_id, user_id) where kind = 'read';

create table public.banners (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  link text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  target text not null default 'home' check (target in ('all', 'home')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create table public.banner_dismissals (
  user_id uuid not null references public.profiles (id) on delete cascade,
  banner_id uuid not null references public.banners (id) on delete cascade,
  primary key (user_id, banner_id)
);

create table public.news_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  feed_url text not null unique,
  lang text not null default 'en' check (lang in ('ja', 'en')),
  weight numeric(3, 2) not null default 0.8 check (weight between 0 and 1),
  enabled boolean not null default true,
  last_success_at timestamptz,
  failure_count int not null default 0,
  terms_checked_at timestamptz, -- 19.6 利用規約の確認日
  created_at timestamptz not null default now()
);

create table public.news_digests (
  id uuid primary key default gen_random_uuid(),
  date date not null unique, -- 1日1件
  status text not null default 'collecting' check (status in ('collecting', 'pending', 'approved', 'sent', 'skipped', 'failed')),
  stage text not null default 'collect' check (stage in ('collect', 'dedupe', 'select', 'summarize', 'review', 'sent')),
  failed_stage text,
  approved_by uuid references public.profiles (id),
  sent_at timestamptz,
  broadcast_id uuid references public.broadcasts (id),
  created_at timestamptz not null default now()
);

create table public.news_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.news_sources (id) on delete cascade,
  url text not null unique, -- 正規化して一意
  title text not null,
  title_ja text not null default '',
  summary_ja text check (char_length(summary_ja) <= 120),
  category text not null default 'model' check (category in ('model', 'product', 'research', 'policy', 'business')),
  published_at timestamptz not null,
  score numeric not null default 0,
  score_detail jsonb not null default '{}',
  digest_id uuid references public.news_digests (id) on delete set null,
  rank int,
  created_at timestamptz not null default now()
);
create index news_items_digest_idx on public.news_items (digest_id, rank);

create table public.news_reactions (
  item_id uuid not null references public.news_items (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('useful', 'bookmark')),
  created_at timestamptz not null default now(),
  primary key (item_id, user_id, kind)
);

-- ---------------------------------------------------------------------------
-- 運営
-- ---------------------------------------------------------------------------
create table public.admin_members (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'moderator', 'publisher', 'viewer')),
  totp_enrolled boolean not null default false,
  created_at timestamptz not null default now()
);

-- 有効な制限を RLS とサーバー関数が参照する
create table public.restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('warning', 'chat_send', 'new_talk', 'chat_all', 'post', 'freeze', 'ban')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  reason_category text not null,
  user_message text not null default '',
  internal_note text not null default '',
  created_by uuid references public.profiles (id),
  lifted_at timestamptz,
  created_at timestamptz not null default now()
);
create index restrictions_active_idx on public.restrictions (user_id) where lifted_at is null;
create index restrictions_due_idx on public.restrictions (ends_at) where lifted_at is null and ends_at is not null;

create table public.appeals (
  id uuid primary key default gen_random_uuid(),
  restriction_id uuid not null references public.restrictions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'lifted', 'kept')),
  decided_by uuid references public.profiles (id),
  result text,
  created_at timestamptz not null default now()
);

-- shared_messages は通報者の同意で提供された写し（対応完了から1年で削除）
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('work', 'user', 'message')),
  target_id text not null,
  reason text not null,
  detail text not null default '' check (char_length(detail) <= 500),
  shared_messages jsonb,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'rejected')),
  assignee_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  first_action_at timestamptz,
  resolved_at timestamptz
);
create index reports_status_idx on public.reports (status, created_at);
create index reports_target_idx on public.reports (target_type, target_id);

create table public.dup_suspicions (
  id uuid primary key default gen_random_uuid(),
  device_hash text not null unique,
  user_ids uuid[] not null,
  status text not null default 'open' check (status in ('open', 'ok', 'confirm', 'suspended')),
  decision text,
  decided_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- 公式アカウント宛てのトーク
create table public.support_threads (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  assignee_id uuid references public.profiles (id),
  status text not null default 'open' check (status in ('open', 'pending', 'closed')),
  last_user_message_at timestamptz not null default now()
);

create table public.support_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.ng_words (
  id uuid primary key default gen_random_uuid(),
  word text not null unique,
  severity text not null check (severity in ('warn', 'block'))
);

-- 追記のみ。誰にも更新と削除の権限を与えない（1年保持）
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default false, -- クライアントが読める設定
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

-- 無料枠モニター用（Supabase 無料プランはログを1日しか残さないため毎日集計して保存）
create table public.usage_snapshots (
  date date not null,
  metric text not null check (metric in ('db_bytes', 'storage_bytes', 'realtime_peak', 'realtime_messages', 'egress_bytes', 'function_invocations', 'worker_requests', 'r2_bytes')),
  value bigint not null,
  primary key (date, metric)
);
