# Vercel に接続する

`vercel.json` と `middleware.ts` は用意済みです。リポジトリを Vercel にインポートし、環境変数を設定すれば配信できます。

> **要件 17.2 との差分**：要件定義書は「Vercel の無料 Hobby プランは非商用の個人利用に限られ、作品を通じて制作の依頼を募る本アプリは商用利用に当たるおそれがあるため使わない」としています。
> 公開時は **Vercel Pro**（月額有料）にするか、要件どおり **Cloudflare（Workers の静的アセット配信）** に切り替えるかを決めてください。
> 本リポジトリの成果物は静的ファイル（`dist/`）なので、どちらにも載せ替えられます（[ADR 0002](adr/0002-vercel-hosting.md)）。

## 1. インポート

1. Vercel の「Add New… > Project」で GitHub の `zeno-space` を選ぶ。
2. Framework Preset は **Vite**（`vercel.json` で指定済み）。Build Command `npm run build`、Output Directory `dist`。
3. Node.js は 22.x。

## 2. 環境変数

Project Settings > Environment Variables に設定します（`.env.example` 参照）。

| 変数 | Production | Preview | 備考 |
| --- | --- | --- | --- |
| `VITE_DATA_SOURCE` | `supabase` | `supabase`（ステージング）または `mock` | 接続前は `mock` のまま配信できる |
| `VITE_SUPABASE_URL` | 本番プロジェクト | ステージング | |
| `VITE_SUPABASE_ANON_KEY` | 本番 | ステージング | anon キーのみ。service_role は入れない |
| `VITE_VAPID_PUBLIC_KEY` | ✓ | ✓ | Web Push の公開鍵 |
| `VITE_R2_PUBLIC_BASE_URL` | ✓ | ✓ | 画像の公開ドメイン |
| `VITE_TURNSTILE_SITE_KEY` | ✓ | ✓ | |
| `VITE_SENTRY_DSN` | 任意 | 任意 | 個人情報は送らない設定にする |

`middleware.ts`（クローラー向け OGP）も `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_R2_PUBLIC_BASE_URL` を読みます。未設定のあいだは何もしません。

## 3. ドメインと CSP

- 独自ドメイン（Q-03）を割り当てたら、Supabase の Site URL、R2 の CORS、Edge Function の `APP_ORIGIN` を同じドメインにそろえる。
- `vercel.json` の `Content-Security-Policy` の `img-src`（`https://img.zenospace.app` は仮の値）を、R2 の公開ドメインに書き換える。
- `connect-src` は `*.supabase.co`（REST・Realtime）、R2 のアップロード先、Sentry を許可済み。

## 4. 配信の仕組み

| パス | 扱い |
| --- | --- |
| `/assets/*` | 1年キャッシュ（ファイル名にハッシュ付き） |
| `/sw.js`、`/manifest.webmanifest` | キャッシュしない（新しい版を「更新」トーストで知らせる：15.4） |
| `/works/:id`、`/u/:handle` | クローラーには OGP を差し込んだ HTML を返す（`middleware.ts`）。人には SPA |
| その他 | `index.html` にリライト（SPA） |

## 5. 確認

- [ ] `https://<ドメイン>/home` が表示され、ホーム画面に追加できる（Android は標準のインストール案内、iPhone は共有メニュー）
- [ ] Lighthouse の PWA・アクセシビリティに問題がない。LCP 2.5秒以内（モバイル）
- [ ] 作品 URL を Slack や X に貼ると OGP カードが出る
- [ ] レスポンスヘッダーに CSP・HSTS・`X-Content-Type-Options: nosniff` が付いている
