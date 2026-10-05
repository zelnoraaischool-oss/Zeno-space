# Vercel に接続する

`vercel.json` と `middleware.ts` は用意済みです。リポジトリを Vercel にインポートし、環境変数を設定すれば配信できます。

> **要件 17.2 との差分**：要件定義書は「Vercel の無料 Hobby プランは非商用の個人利用に限られ、作品を通じて制作の依頼を募る本アプリは商用利用に当たるおそれがあるため使わない」としています。
> 公開時は **Vercel Pro**（月額有料）にするか、要件どおり **Cloudflare（Workers の静的アセット配信）** に切り替えるかを決めてください。
> 本リポジトリの成果物は静的ファイル（`dist/`）なので、どちらにも載せ替えられます（[ADR 0002](adr/0002-vercel-hosting.md)）。

## 1. インポート

1. Vercel の「Add New… > Project」で GitHub の `zeno-space` を選ぶ。
2. Framework Preset は **Vite**（`vercel.json` で指定済み）。Build Command は `vercel.json` の `node scripts/migrate.mjs && npm run build`、Output Directory は `dist`。
3. Node.js は 22.x。

## 2. 環境変数

Project Settings > Environment Variables に設定します（`.env.example` 参照）。
**Supabase の URL と公開鍵があれば Supabase に接続**し、なければモック（デモ）で配信します（`VITE_DATA_SOURCE` で明示もできる）。

| 変数                                                         | 必須 | 備考                                                                                                     |
| ------------------------------------------------------------ | ---- | -------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓    | Vercel の Supabase 連携が入れる名前のまま読める。`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` でもよい |
| `POSTGRES_URL_NON_POOLING`（または `SUPABASE_DB_URL`）       | ✓    | 本番ビルドでマイグレーションを適用する接続先。ブラウザには渡らない                                       |
| `MIGRATE`                                                    |      | `1` でプレビューでも適用、`0` で適用しない（既定は本番ビルドだけ適用）                                   |
| `VITE_AUTH_PROVIDERS`                                        |      | `google` / `google,github`。Supabase で外部ログインを有効にしたら設定する                                |
| `VITE_VAPID_PUBLIC_KEY`                                      |      | Web Push の公開鍵（Edge Function を配置したとき）                                                        |
| `VITE_TURNSTILE_SITE_KEY` / `VITE_SENTRY_DSN`                |      | 任意                                                                                                     |

service_role / secret の鍵は入れません（ブラウザに渡すのは公開鍵だけ：17.5）。
`middleware.ts`（クローラー向け OGP）も同じ変数を読みます。

接続の手順全体は [Supabase に接続する](supabase-setup.md) を見てください。

## 3. ドメインと CSP

- 独自ドメイン（Q-03）を割り当てたら、Supabase の Site URL、R2 の CORS、Edge Function の `APP_ORIGIN` を同じドメインにそろえる。
- 画像は Supabase Storage（`*.supabase.co`）から配信します（CSP で許可済み）。R2 に移したら、`vercel.json` の `img-src`（`https://img.zenospace.app` は仮の値）を R2 の公開ドメインに書き換える。
- `connect-src` は `*.supabase.co`（REST・Realtime）、R2 のアップロード先、Sentry を許可済み。

## 4. 配信の仕組み

| パス                              | 扱い                                                                       |
| --------------------------------- | -------------------------------------------------------------------------- |
| `/assets/*`                       | 1年キャッシュ（ファイル名にハッシュ付き）                                  |
| `/sw.js`、`/manifest.webmanifest` | キャッシュしない（新しい版を「更新」トーストで知らせる：15.4）             |
| `/works/:id`、`/u/:handle`        | クローラーには OGP を差し込んだ HTML を返す（`middleware.ts`）。人には SPA |
| その他                            | `index.html` にリライト（SPA）                                             |

## 5. 確認

- [ ] `https://<ドメイン>/home` が表示され、ホーム画面に追加できる（Android は標準のインストール案内、iPhone は共有メニュー）
- [ ] Lighthouse の PWA・アクセシビリティに問題がない。LCP 2.5秒以内（モバイル）
- [ ] 作品 URL を Slack や X に貼ると OGP カードが出る
- [ ] レスポンスヘッダーに CSP・HSTS・`X-Content-Type-Options: nosniff` が付いている
