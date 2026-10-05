# zenospace

> つくったものが、会話のはじまりになる。

「LINE 型チャット」と「物件サイト型の作品ショーケース」を1アカウントで使える PWA。
要件定義書 v0.1（2026-09-30）をもとに、**Vercel と Supabase に接続する直前まで**を実装しています。

- フロントエンドは全画面が動きます（ユーザー向け 24 画面＋運営コンソール 16 画面）。データは端末内の**モックDB**で動きます。
- Supabase 側は**マイグレーション（スキーマ・RLS・RPC・Realtime・pg_cron）と Edge Functions** を用意済みです。接続すれば `supabase db push` で反映できます。
- Vercel 側は `vercel.json`（SPA 配信・セキュリティヘッダー）とクローラー向け OGP の Middleware を用意済みです。

## すぐに動かす

```bash
npm install
npm run dev        # http://localhost:5173
```

ログイン画面の「Google ではじめる」→ デモアカウントを選びます（モック動作中は実際の Google 認証は行いません）。

| デモアカウント | 役割 |
| --- | --- |
| くら（kura@example.com） | 運営オーナー。運営コンソール `/admin` に入れます（確認コード `123456`） |
| みお（mio.design@gmail.com） | LP 制作者（依頼受付中） |
| たく（taku.dev@gmail.com） | エンジニア |
| はな（hana.illust@gmail.com） | イラストレーター |

メール OTP のデモコードも `123456` です。データを初期状態に戻すには、設定画面の下部「デモデータを初期化」を押します。
2つのタブで別のユーザーとしてログインすると、メッセージや利用制限がもう一方のタブに即時に反映されます（Realtime の代わり）。

## スクリプト

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー |
| `npm run build` | 型検査＋本番ビルド（PWA の Service Worker を生成） |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript（strict） |
| `npm test` | 単体テスト（Vitest）。20.2 受け入れ基準の主要シナリオをデータ層で確認 |
| `npm run test:e2e` | 画面の通し（Playwright。スマホ・PC の2構成） |
| `npm run check:bundle` | 初回に読み込む JS が gzip 後 200KB 以下か確認（18.1） |
| `npm run db:verify` | 素の PostgreSQL 16 にマイグレーションを流し、RLS と制限の強制を検証 |
| `npm run icons` | PWA アイコンと OGP 既定画像を生成 |

## 構成

```
src/
  app/            セッション、表示設定、PWA の案内、規約の再同意
  components/     UI 部品（デザイントークン「Quiet Grove」（グレー×深緑））、作品カード、グラフ、レイアウト
  pages/          ユーザー向け画面（U-01〜U-24）
  pages/talk/     トークリスト・トークルーム・グループ・友だち追加・リクエスト
  pages/admin/    運営コンソール（A-01〜A-16）
  lib/api/        データ層の入口（api）。mock/ がモック実装
  lib/mock/       モックDB（localStorage）と初期データ
  lib/supabase/   Supabase クライアント（接続後に使う）
supabase/
  migrations/     スキーマ・RLS・RPC・検索（PGroonga）・Realtime・pg_cron
  functions/      Edge Functions（OGP 取得、R2 署名付き URL、Web Push、一斉配信、AI ニュース など）
  tests/local/    素の PostgreSQL での検証（シムと検証 SQL）
  seed.sql        マスタ、設定、公式アカウント
e2e/              Playwright（受け入れ基準）
docs/             接続手順、要件対応表、ADR
```

## 接続の手順

1. [Supabase に接続する](docs/supabase-setup.md)
2. [Vercel に接続する](docs/vercel-setup.md)
3. `VITE_DATA_SOURCE=supabase` に切り替え、モック実装を Supabase 実装に差し替える（[対応表](docs/supabase-setup.md#6-フロントエンドの差し替え)）

要件ごとの実装状況は [docs/requirements-coverage.md](docs/requirements-coverage.md) を見てください。

> **注意（要件 17.2）**：要件定義書は「Vercel の無料 Hobby プランは非商用の個人利用に限られるため使わない」としています。
> 本リポジトリはご指示どおり Vercel 向けに設定していますが、公開時は Pro プランにするか、要件どおり Cloudflare から配信するかを判断してください（[ADR 0002](docs/adr/0002-vercel-hosting.md)）。
