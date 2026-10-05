-- =============================================================================
-- zenospace 0009: 初期データ（マスタ・設定・公式アカウント）
-- 本番でもマイグレーションとして1回だけ流れるよう、何度実行しても重複しない書き方にする。
-- =============================================================================

-- 公式アカウント（全ユーザーのトークリストに常駐：9.1）
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000001', 'official@zenospace.invalid', '{"provider":"system"}', '{"name":"zenospace 公式"}')
on conflict (id) do nothing;
insert into public.profiles (id, handle, display_name, is_official, commission_status, onboarded, bio, avatar_color)
values ('00000000-0000-4000-8000-000000000001', 'zenospace', 'zenospace 公式', true, 'closed', true, 'zenospace の公式アカウントです。毎朝のAIニュースとお知らせを届けます。', '#1F4D3B')
on conflict (id) do nothing;

insert into public.categories (name, normalized_name, sort_order) values
  ('飲食', '飲食', 0), ('美容', '美容', 1), ('医療', '医療', 2), ('不動産', '不動産', 3), ('EC', 'ec', 4),
  ('教育', '教育', 5), ('SaaS', 'saas', 6), ('士業', '士業', 7), ('エンタメ', 'えんため', 8), ('その他', 'そのた', 9)
on conflict do nothing;

insert into public.techs (name, normalized_name, sort_order) values
  ('React', 'react', 0), ('Next.js', 'next.js', 1), ('Vue', 'vue', 2), ('WordPress', 'wordpress', 3), ('STUDIO', 'studio', 4),
  ('Wix', 'wix', 5), ('Shopify', 'shopify', 6), ('Figma', 'figma', 7), ('Canva', 'canva', 8), ('Photoshop', 'photoshop', 9),
  ('Illustrator', 'illustrator', 10), ('Flutter', 'flutter', 11), ('Swift', 'swift', 12), ('Kotlin', 'kotlin', 13),
  ('Premiere Pro', 'premiere pro', 14), ('After Effects', 'after effects', 15), ('Tailwind CSS', 'tailwind css', 16), ('TypeScript', 'typescript', 17)
on conflict do nothing;

-- システム設定（ZS-ADM-22）。is_public はクライアントが読める設定
insert into public.app_settings (key, value, is_public) values
  ('invite_only', 'false', true),
  ('send_rate_per_minute', '30', false),
  ('new_user_daily_new_talks', '10', false),
  ('group_max_members', '100', true),
  ('upload_max_mb', '10', true),
  ('maintenance', '{"enabled":false,"until":null,"message":""}', true),
  ('report_auto_hide_threshold', '3', false),
  ('broadcast_daily_limit', '2', false),
  ('broadcast_approval_required', 'true', false),
  ('heavy_features_paused', 'false', true),
  ('terms_version', '"2026-09-30"', true),
  ('privacy_version', '"2026-09-30"', true),
  ('news', '{"time":"07:30","days":"daily","mode":"approval","count":5,"minCount":3,"includeKeywords":["AI","LLM","生成AI"],"excludeKeywords":["PR","広告"],"provider":"workers-ai"}', false)
on conflict (key) do nothing;

insert into public.ng_words (word, severity) values ('必ず儲かる', 'block'), ('LINE交換', 'warn') on conflict do nothing;

insert into public.news_sources (name, feed_url, lang, weight) values
  ('Anthropic News', 'https://www.anthropic.com/news/rss.xml', 'en', 1.0),
  ('OpenAI Blog', 'https://openai.com/blog/rss.xml', 'en', 1.0),
  ('Google DeepMind Blog', 'https://deepmind.google/blog/rss.xml', 'en', 0.9),
  ('ITmedia AI+', 'https://rss.itmedia.co.jp/rss/2.0/aiplus.xml', 'ja', 0.8)
on conflict do nothing;

insert into public.support_templates (title, body)
select t.title, t.body from (values
  ('お問い合わせのお礼', 'お問い合わせありがとうございます。確認して改めてご連絡します。'),
  ('ログインできない', 'メールに届くコードでのログインをお試しください。解決しない場合は、お使いの端末とブラウザを教えてください。')
) t (title, body)
where not exists (select 1 from public.support_templates x where x.title = t.title);

-- 歓迎メッセージ（全員配信：登録時点で全員宛て。新規登録者には broadcast_recipients で個別に追加する）
-- 宛先は新規登録時に broadcast_recipients へ追加する（handle_new_user）。全員宛てではなく「登録した人」宛て
insert into public.broadcasts (title, status, audience, bubbles, push_text, sent_at, push_sent_at, created_by)
select 'ようこそ', 'sent', 'segment', '[{"type":"text","text":"{name}さん、zenospace へようこそ！\n作品を見つけて、気になった制作者とそのまま話してみましょう。"}]', 'zenospace へようこそ！', now(), now(), '00000000-0000-4000-8000-000000000001'
where not exists (select 1 from public.broadcasts where title = 'ようこそ');
