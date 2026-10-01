# Supabase に接続する

マイグレーション・RLS・RPC・Edge Functions は用意済みです。ここではプロジェクトを作ってつなぐ手順と、フロントエンドの差し替え方をまとめます。

## 0. 接続前に確認できること

```bash
# 素の PostgreSQL 16 で、マイグレーション（PGroonga と pg_cron を除く）と RLS を検証する
PGHOST=localhost PGUSER=postgres npm run db:verify
```

`supabase/tests/local/verify.sql` が次を確かめます（要件 20.2 の一部）。

- 1人1アカウント：ドットや `+` だけが違う Gmail で2つ目のアカウントが作れない
- 参加していないトークのメッセージは読めず、書き込めない
- チャット送信停止中は RPC でも直接 insert でも送れない。公式アカウントとのトークには送れる
- TOTP 未済み（aal1）の運営は利用制限を実行できない。監査ログは誰も削除できない
- 期限が来た制限は自動で解除される
- 友だちでない相手からの最初のメッセージはリクエストに入る。ブロック後のメッセージは届かない
- 一斉配信の本文は1件だけ保存され、全員配信で宛先の行が増えない。取り消すと全員の画面から消える
- Realtime の `room:{id}` は参加者だけが購読できる

## 1. プロジェクトを作る

1. Supabase で **本番** と **ステージング** の2プロジェクトを作る（無料プランの上限：17.5）。リージョンは **Tokyo（ap-northeast-1）**。
2. Database > Extensions で `pgroonga`、`pg_cron`、`pg_net` を有効にする（マイグレーションでも `create extension` する）。
3. ローカルで CLI をつなぐ。

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push          # supabase/migrations を適用
psql "$SUPABASE_DB_URL" -f supabase/seed.sql   # マスタ・設定・公式アカウント（初回のみ）
npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts
```

> 公式アカウント（`00000000-0000-4000-8000-000000000001`）は `seed.sql` で `auth.users` と `profiles` に作ります。

## 2. 認証（5.1）

| 設定 | 場所 | 値 |
| --- | --- | --- |
| Google | Authentication > Providers | Google Cloud の OAuth クライアント。リダイレクト URL に `https://<project>.supabase.co/auth/v1/callback` |
| GitHub | 同上 | GitHub OAuth App |
| メール OTP | Authentication > Email | 「Email OTP」を有効、桁数6、Magic Link は使わない |
| SMTP | Project Settings > Auth > SMTP | **Resend** の SMTP（標準のメール送信は1時間2通まで：17.5）。新規登録メールの上限（初期値 1時間30人）を公開前に見直す |
| MFA | Authentication > MFA | TOTP を有効（運営コンソールは TOTP 必須：3.2） |
| CAPTCHA | Authentication > Attack Protection | Cloudflare Turnstile（18.3） |
| Site URL | Authentication > URL Configuration | `https://<本番ドメイン>`、追加のリダイレクトに `https://*.vercel.app/**`（プレビュー用） |
| アカウントの自動連携 | Authentication > Providers | 同じ確認済みメールは同じユーザーに連携（ZS-AUTH-03） |

1人1アカウントの判定は `auth.users` への insert で動くトリガー `private.handle_new_user()` が行います。重複時は `duplicate_account` で登録を止めるので、クライアントは連携の案内（ログイン画面の「既存のアカウントに連携」）を出します。

## 3. 秘密情報

### Vault（pg_cron から Edge Function を呼ぶため）

```sql
select vault.create_secret('https://<project>.supabase.co', 'project_url');
select vault.create_secret('<service_role_key>', 'service_role_key');
```

### Edge Function の Secrets

```bash
npx supabase secrets set \
  APP_ORIGIN=https://<本番ドメイン> \
  VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:ops@<ドメイン> \
  R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=zenospace-media R2_PUBLIC_BASE_URL=https://img.<ドメイン> \
  CF_ACCOUNT_ID=... CF_AI_TOKEN=... \
  GEMINI_API_KEY=... \
  SLACK_WEBHOOK_URL=...
```

VAPID 鍵は `npx web-push generate-vapid-keys` で作ります。公開鍵はフロントエンドの `VITE_VAPID_PUBLIC_KEY` にも設定します。
**service_role の鍵はフロントエンドや Vercel の `VITE_` 変数に入れない**こと（17.5）。

## 4. Edge Functions

```bash
npx supabase functions deploy og-fetch upload-url push-dispatch broadcast-dispatch ai-news retention usage-monitor saved-search-notify
```

| 関数 | 呼び出し元 | 内容 |
| --- | --- | --- |
| `og-fetch` | アプリ（ログイン済み） | URL の OGP 取得。内部アドレス禁止・リダイレクト3回・5秒（SSRF 対策） |
| `upload-url` | アプリ（ログイン済み） | R2 の署名付きアップロード URL（5分）。種類と容量を確認、SVG 不可 |
| `push-dispatch` | Database Webhook（`notifications` の INSERT）／pg_cron | Web Push 送信。410 の購読は削除 |
| `broadcast-dispatch` | pg_cron（1分ごと） | 一斉配信の Push を 500人ずつ送る |
| `ai-news` | pg_cron（7:00 JST に collect、毎分 deliver） | RSS 収集→重複除去→選定→要約→承認待ち→配信 |
| `retention` | pg_cron（3:30 JST） | 保持期間を過ぎた R2 のファイルを削除 |
| `usage-monitor` | pg_cron（0:10 JST） | 無料枠の 70% / 90% を Slack に通知、90% で重い機能を停止 |
| `saved-search-notify` | pg_cron（8:00 JST） | 保存した検索条件の新着通知 |

**Database Webhook**：Database > Webhooks で `public.notifications` の INSERT を `push-dispatch` に送る（Authorization に service_role）。

## 5. Cloudflare R2

1. バケット `zenospace-media`（画像・ファイル）と `zenospace-backup`（DB バックアップ）を作る。
2. メディア用バケットに独自ドメインを割り当てる（`r2.dev` は本番で使わない：17.5 / Q-03）。
3. CORS：`PUT` を `https://<本番ドメイン>` と `https://*.vercel.app` から許可。`Content-Type` ヘッダーを許可。
4. API トークン（Object Read & Write）を作り、Edge Function の Secrets と GitHub Actions の Secrets に設定。

## 6. フロントエンドの差し替え

画面はすべて `src/lib/api` の `api` を通してデータを読み書きしています。`Api` 型（`typeof mockApi`）を満たす Supabase 実装を `src/lib/api/supabase/` に作り、`src/lib/api/index.ts` で `VITE_DATA_SOURCE` によって切り替えます。

```ts
// src/lib/api/index.ts（接続後）
export const api: Api = dataSource === 'supabase' ? supabaseApi : mockApi
```

| api のメソッド | Supabase での実装 |
| --- | --- |
| `auth.signInWithProvider` | `supabase.auth.signInWithOAuth({ provider })`（PKCE）。戻り後に `record_device(端末ハッシュ)` |
| `auth.sendEmailOtp` / `verifyEmailOtp` | `auth.signInWithOtp({ email })` / `auth.verifyOtp({ email, token, type: 'email' })` |
| `auth.completeSignUp` | RPC `complete_signup(birth_ym, terms_version, privacy_version)` |
| `auth.linkAndSignIn` / `linkProvider` | `auth.linkIdentity({ provider })` |
| `auth.changeHandle` / `requestDeletion` | RPC `change_handle` / `request_account_deletion` |
| `auth.verifyAdminTotp` | `auth.mfa.challenge` → `auth.mfa.verify`（aal2 になる） |
| `users.*` | `profiles`、`friendships`、`blocks`、`user_settings`、`my_restrictions` ビュー、`appeals` |
| `chat.listRooms` | `room_members`＋`rooms`（未読は `messages.created_at > last_read_at` の件数） |
| `chat.listMessages` | `messages`（`id desc` で30件ずつ）＋公式トークは RPC `official_feed` |
| `chat.send` | RPC `send_message(room, body, client_id, kind, reply_to, meta)` |
| `chat.markRead` | RPC `mark_read`（2秒ごとにまとめる） |
| `chat.openDirect` / `openInquiry` / `createGroup` | RPC `open_direct` / `open_inquiry` / `create_group` |
| `chat.unsend` / `react` / `hideForMe` | RPC `unsend_message` / `reactions` / `message_hides` |
| リアルタイム | `subscribeRoom(roomId)`（`src/lib/supabase/client.ts`）。裏に回ったら切断 |
| `works.list` / `count` / `facets` | RPC `search_works(query, offset, limit)`（PGroonga）。Worker/Edge で60秒キャッシュ |
| `works.get` / `update` / `publish` | `works`＋`work_media`＋`work_techs`＋`work_tags`（公開の必須チェックはトリガー） |
| `works.setLike` / `recordView` | `likes`（件数はトリガー）/ RPC `record_view` |
| `works.fetchOgp` | Edge Function `og-fetch` |
| `storage.uploadImage` | 端末で WebP 化（`processImage`）→ `upload-url` → R2 へ PUT |
| `notifications.*` | `notifications`、`push_subscriptions` |
| `news.*` | `news_digests`＋`news_items`＋`news_reactions` |
| `reports.create` | `reports`（自動非表示はトリガー） |
| `admin.restrict` / `liftRestriction` | RPC `admin_restrict` / `admin_lift_restriction` |
| `admin.approveAndSend` / `cancelBroadcast` / `broadcastReport` | RPC `admin_send_broadcast` / `admin_cancel_broadcast` / `admin_broadcast_report` |
| `admin.approveNews` | RPC `admin_approve_news` |
| `admin.updateReport` / `setWorkHidden` / `decideAppeal` / `supportReply` | RPC `admin_update_report` / `admin_set_work_hidden` / `admin_decide_appeal` / `admin_support_reply` |
| `admin.banners` / マスタ / 設定 / メンバー | 各テーブルへ直接（RLS で運営ロールを確認し、トリガーが監査ログへ記録） |
| `admin.usage` | `usage_snapshots` |

モック専用のもの（`src/lib/mock/`、`src/lib/api/mock/simulate.ts`、`jobs.ts`）は差し替え後に削除します。

## 7. 接続後の確認

```bash
npx supabase db reset            # ローカル（Docker）でマイグレーション＋seed
npx supabase test db             # pgTAP（supabase/tests/*.test.sql を追加して実行）
VITE_DATA_SOURCE=supabase npm run test:e2e
```

- [ ] Google / GitHub / メール OTP でログインできる
- [ ] ドットや `+` 違いの Gmail で2つ目のアカウントが作れない
- [ ] 運営コンソールに TOTP で入れる
- [ ] 2つの端末でトークの送受信・既読がリアルタイムに反映される
- [ ] Web Push が届く（iPhone はホーム画面に追加した PWA で）
- [ ] 毎朝 7:30 に AI ニュースの下書きが届き、承認で配信される
- [ ] 無料枠モニターに DB 容量が出る
