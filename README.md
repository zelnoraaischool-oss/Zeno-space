# zenospace

> つくったものが、会話のはじまりになる。

「LINE 型チャット」と「物件サイト型の作品ショーケース」を1アカウントで使える PWA。
要件定義書 v0.1（2026-09-30）をもとに実装しています。

- **Supabase に接続して実際に使えます**。Supabase の URL と公開鍵があれば自動で接続し（Vercel の Supabase 連携の変数名のままで可）、本番ビルドのときにマイグレーションも自動で適用します。手順は [Supabase に接続する](docs/supabase-setup.md)。
- 接続先がないときは、端末内の**モックDB**（デモアカウント入り）で全画面を試せます。
- 画面：ユーザー向け 24 画面＋運営コンソール 16 画面。認証はメールのワンタイムコード（Google / GitHub は設定すれば追加）、画像は Supabase Storage、トークは Realtime。

## すぐに動かす（モック）

```bash
npm install
npm run dev        # http://localhost:5173
```

接続先（`.env.local` の `VITE_SUPABASE_URL` など）がなければモックで動きます。ログイン画面の「Google ではじめる」→ デモアカウントを選びます（モック動作中は実際の Google 認証は行いません）。

| デモアカウント                | 役割                                                                    |
| ----------------------------- | ----------------------------------------------------------------------- |
| くら（kura@example.com）      | 運営オーナー。運営コンソール `/admin` に入れます（確認コード `123456`） |
| みお（mio.design@gmail.com）  | LP 制作者（依頼受付中）                                                 |
| たく（taku.dev@gmail.com）    | エンジニア                                                              |
| はな（hana.illust@gmail.com） | イラストレーター                                                        |

メール OTP のデモコードも `123456` です。データを初期状態に戻すには、設定画面の下部「デモデータを初期化」を押します。
2つのタブで別のユーザーとしてログインすると、メッセージや利用制限がもう一方のタブに即時に反映されます（Realtime の代わり）。

## スクリプト

| コマンド                             | 内容                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `npm run dev`                        | 開発サーバー                                                                   |
| `npm run build`                      | 型検査＋本番ビルド（PWA の Service Worker を生成）                             |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript（strict）                                                  |
| `npm test`                           | 単体テスト（Vitest）。20.2 受け入れ基準の主要シナリオをデータ層で確認          |
| `npm run test:e2e`                   | 画面の通し（Playwright・モック。スマホ・PC の2構成）                           |
| `npm run test:e2e:supabase`          | 画面の通し（手元の本物の Supabase：`npx supabase start` が必要）               |
| `npm run check:bundle`               | 初回に読み込む JS が gzip 後 200KB 以下か確認（18.1）                          |
| `npm run db:verify`                  | 手元の Supabase の DB を作り直し、1人1アカウント・RLS・制限の強制を SQL で検証 |
| `npm run db:migrate`                 | `SUPABASE_DB_URL` の DB に未適用のマイグレーションを流す（本番ビルドでは自動） |
| `npm run icons`                      | PWA アイコンと OGP 既定画像を生成                                              |

## 構成

```
src/
  app/            セッション、表示設定、PWA の案内、規約の再同意
  components/     UI 部品（デザイントークン「Quiet Grove」（グレー×深緑））、作品カード、グラフ、レイアウト
  pages/          ユーザー向け画面（U-01〜U-24）
  pages/talk/     トークリスト・トークルーム・グループ・友だち追加・リクエスト
  pages/admin/    運営コンソール（A-01〜A-16）
  lib/api/        データ層の入口（api）。supabase/ が本番の実装、mock/ がモック実装（ビルド時に片方だけ含める）
  lib/mock/       モックDB（localStorage）と初期データ
  lib/supabase/   Supabase クライアント（認証・データ・リアルタイムだけを組み立てた軽量版）
supabase/
  migrations/     スキーマ・RLS・RPC・検索（PGroonga）・Realtime・pg_cron・Storage・初期データ
  functions/      Edge Functions（OGP 取得、Web Push、一斉配信、AI ニュース など）
  templates/      ログインメールのテンプレート（6桁のコード入り）
  tests/local/    RLS と制限の強制を確かめる検証 SQL
e2e/              Playwright（受け入れ基準・モック）
e2e-supabase/     Playwright（手元の Supabase に対する通し）
scripts/migrate.mjs  マイグレーションの適用（Vercel の本番ビルドで自動実行）
docs/             接続手順、要件対応表、ADR
```

## 接続の手順

1. [Supabase に接続する](docs/supabase-setup.md)（Vercel に Supabase を連携済みなら、デプロイと認証の設定だけ）
2. [Vercel に接続する](docs/vercel-setup.md)

要件ごとの実装状況は [docs/requirements-coverage.md](docs/requirements-coverage.md) を見てください。

> **注意（要件 17.2）**：要件定義書は「Vercel の無料 Hobby プランは非商用の個人利用に限られるため使わない」としています。
> 本リポジトリはご指示どおり Vercel 向けに設定していますが、公開時は Pro プランにするか、要件どおり Cloudflare から配信するかを判断してください（[ADR 0002](docs/adr/0002-vercel-hosting.md)）。
