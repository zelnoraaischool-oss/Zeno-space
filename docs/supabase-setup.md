# Supabase に接続する

アプリは **Supabase の URL と公開鍵が設定されていれば自動で Supabase に接続**し、なければ端末内のモック（デモ）で動きます。
データの読み書き（`src/lib/api/supabase/`）、マイグレーション（スキーマ・RLS・RPC・Realtime・pg_cron・Storage）、初期データはすべて用意済みです。

## 最短の手順（Vercel に Supabase を連携済みの場合）

1. **Vercel の環境変数を確認する**（Project Settings > Environment Variables）。Vercel の Supabase 連携を使うと次が入ります。

   | 変数                                                            | 使いみち                                                     |
   | --------------------------------------------------------------- | ------------------------------------------------------------ |
   | `NEXT_PUBLIC_SUPABASE_URL`（または `SUPABASE_URL`）             | 接続先。ビルド時にブラウザ用へ読み替える                     |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY`（または `..._PUBLISHABLE_KEY`） | 公開してよい鍵。ブラウザに渡すのはこれだけ                   |
   | `POSTGRES_URL_NON_POOLING`                                      | ビルド時のマイグレーション適用に使う（ブラウザには渡さない） |

   連携を使わずに設定する場合は、Supabase の Project Settings > API から `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY`、
   Database > Connect の **Session pooler** の接続文字列を `SUPABASE_DB_URL` として登録します。
   **service_role / secret の鍵は Vercel にもブラウザにも入れません**（17.5）。

2. **本番にデプロイする**（`main` へのマージ、または Vercel の「Redeploy」）。
   本番ビルドの最初に `scripts/migrate.mjs` が `supabase/migrations/` のうち未適用のものだけを適用します（初回は10件。2回目以降は差分だけ）。
   適用済みの記録は Supabase CLI と同じ `supabase_migrations.schema_migrations` に残るので、あとから `supabase db push` を使っても二重に適用されません。

   > プレビュー（ブランチ）のビルドでは、レビュー前の変更を本番の DB に入れないよう適用しません。
   > プレビュー用に別の Supabase プロジェクトを使うときは、その環境だけ `MIGRATE=1` を設定すると適用されます。

3. **Supabase の管理画面で認証を設定する**（Authentication）。

   | 設定           | 場所                                | 値                                                                                                                                                                 |
   | -------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | Site URL       | URL Configuration                   | `https://<本番ドメイン>`                                                                                                                                           |
   | Redirect URLs  | URL Configuration                   | `https://<本番ドメイン>/**` と、プレビュー用に `https://*-<Vercelのチーム名>.vercel.app/**`                                                                        |
   | ログインメール | Emails > Templates > **Magic Link** | 件名「zenospace のログインコード」、本文に [`supabase/templates/magic_link.html`](../supabase/templates/magic_link.html) を貼る（6桁のコードとボタンの両方が届く） |
   | MFA            | Multi-Factor > TOTP                 | 有効（運営コンソールは TOTP 必須：3.2。新しいプロジェクトは最初から有効）                                                                                          |

   メールのテンプレートを変えない場合も、メールの「Sign in」リンクを同じ端末・同じブラウザで開けばログインできます。

4. **アプリでメールアドレスを入れてログインする**。最初に登録した人が、`/admin/login` の「オーナーになる」から運営オーナーになり、
   認証アプリ（Google Authenticator など）で QR コードを読み取って運営コンソールに入ります（オーナーを決められるのは1人目だけ）。

ここまでで、登録・プロフィール・作品の投稿（画像は Supabase Storage）・検索・いいね・問い合わせ・トーク（リアルタイム・既読）・グループ・通知・運営コンソール（利用制限・一斉配信・通報・監査ログ）が動きます。

## 公開前に必ず行うこと

- **メール送信（SMTP）**：Supabase 標準のメール送信は**1時間に数通まで**で、テスト用です。
  Project Settings > Auth > SMTP に **Resend** などの SMTP を設定し、Authentication > Rate Limits の上限を見直します（17.5）。
- **無料プランの一時停止**：Supabase の無料プランは7日間アクセスがないと一時停止します。公開後は Pro にするか、定期的にアクセスがある状態にします。
- **Google ログイン（任意）**：Authentication > Providers > Google に Google Cloud の OAuth クライアントを登録し、
  Vercel に `VITE_AUTH_PROVIDERS=google`（GitHub も使うなら `google,github`）を設定します。設定するまでボタンは表示しません。

## 任意：Edge Functions と定期処理

次の機能は Edge Function を配置すると動きます（配置しなくてもアプリは動きます）。

| 関数                                                  | 内容                                                 | 配置しない場合                                   |
| ----------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------ |
| `og-fetch`                                            | 作品の URL から OGP を取得                           | URL のドメイン名をタイトル候補にする             |
| `push-dispatch` / `broadcast-dispatch`                | Web Push の送信                                      | 通知はアプリ内（通知一覧・バッジ）だけ           |
| `ai-news`                                             | 毎朝の AI ニュースの収集・要約・配信                 | 運営コンソールの「今すぐ収集する」がエラーになる |
| `retention` / `usage-monitor` / `saved-search-notify` | 保持期間の削除・無料枠の通知・保存した検索の新着通知 | DB 側の定期処理（pg_cron）だけ動く               |

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase functions deploy og-fetch push-dispatch broadcast-dispatch ai-news retention usage-monitor saved-search-notify
npx supabase secrets set APP_ORIGIN=https://<本番ドメイン> VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:ops@<ドメイン>
```

pg_cron から Edge Function を呼ぶため、SQL Editor で Vault に URL と鍵を登録します（pg_cron の定期処理のうち、期限切れの制限の解除・集計の補正・保持期間の削除は Vault なしで動きます）。

```sql
select vault.create_secret('https://<project>.supabase.co', 'project_url');
select vault.create_secret('<service_role_key>', 'service_role_key');
```

Web Push の VAPID 鍵は `npx web-push generate-vapid-keys` で作り、公開鍵を Vercel の `VITE_VAPID_PUBLIC_KEY` にも設定します。

## 画像の保存先

R2 へ移すまでは Supabase Storage の公開バケット `media` に保存します（マイグレーションで作成。1枚10MBまで、WebP / JPEG / PNG / GIF）。
保存先のパスの先頭は本人のユーザーIDで、他人のフォルダには書き込めません（RLS）。端末側で縮小・WebP 変換し、位置情報（EXIF）を消してから送ります。
無料プランの Storage は 1GB までです。運営コンソールの無料枠モニターに使用量が出ます。

## 手元で Supabase につないで確かめる

Docker があれば、本物の Supabase（認証・Storage・Realtime・メール受信箱つき）を手元で動かせます。

```bash
npx supabase start                 # 初回はイメージの取得に数分。マイグレーションも適用される
npm run test:e2e:supabase          # 画面の通し（メールOTP・投稿・検索・いいね・問い合わせ・リアルタイム・グループ・一斉配信・運営）
npm run db:verify                  # DB を作り直し、1人1アカウント・RLS・制限の強制を SQL で検証
```

開発サーバーを手元の Supabase につなぐときは `.env.local` に次を書きます（`npx supabase status` で表示される値）。
ログインメールは http://127.0.0.1:54324 （Mailpit）で読めます。

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<Publishable key>
```

`supabase/tests/local/verify.sql` が確かめること（要件 20.2 の一部）：

- 1人1アカウント：ドットや `+` だけが違う Gmail で2つ目のアカウントが作れない
- 参加していないトークのメッセージは読めず、書き込めない
- チャット送信停止中は RPC でも直接 insert でも送れない。公式アカウントとのトークには送れる。制限の社内メモは本人に見えない
- TOTP 未済み（aal1）の運営は利用制限を実行できない。監査ログは誰も削除できない
- 期限が来た制限は自動で解除される
- 友だちでない相手からの最初のメッセージはリクエストに入る。ブロック後のメッセージは届かない
- 一斉配信の本文は1件だけ保存され、全員配信で宛先の行が増えない。取り消すと全員の画面から消える

## データ層の対応（参考）

画面は `src/lib/api` の `api` だけを使います。Supabase 実装（`src/lib/api/supabase/`）はモック実装と同じ型を満たします（型検査で確認）。

| api                                                  | Supabase での実装                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `auth.sendEmailOtp` / `verifyEmailOtp`               | `auth.signInWithOtp` / `auth.verifyOtp`。登録の途中（規約同意前）は RPC `complete_signup` で完了                                |
| `auth.verifyAdminTotp` / `adminSetup` / `claimOwner` | MFA（TOTP）の登録・確認で aal2 に。最初のオーナーは RPC `claim_owner`                                                           |
| `users.*`                                            | `profiles`（生年月を除く列）・`friendships`・`blocks`・`user_settings`・RPC `my_state` / `profile_stats` / `friend_suggestions` |
| `chat.listRooms` / 未読数                            | RPC `my_rooms`（未読・相手・公式配信をまとめて返す）                                                                            |
| `chat.listMessages` / `send` / `markRead`            | `messages`（RLS）＋公式トークは RPC `official_feed` / RPC `send_message` / RPC `mark_read`                                      |
| グループ・招待・リクエスト                           | RPC `create_group` / `room_*` / `request_respond`                                                                               |
| リアルタイム                                         | 本人のチャンネル `user:{id}`（新着・通知・制限）と、開いているトークの `room:{id}`（新着・既読・リアクション）                  |
| `works.list` / `count` / `facets`                    | RPC `search_works` / `search_facets`（PGroonga）                                                                                |
| `works.update` / `publish` / `trash`                 | RPC `save_work`（タグ・使用技術・画像）/ `works.visibility`（公開の必須チェックはトリガー）/ RPC `work_set_trashed`             |
| `storage.uploadImage`                                | 端末で WebP 化 → Storage の `media` バケット                                                                                    |
| `admin.*`                                            | 運営用 RPC（`admin_*`）と RLS（aal2 のみ）。操作は監査ログに残る                                                                |
