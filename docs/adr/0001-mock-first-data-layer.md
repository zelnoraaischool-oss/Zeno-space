# ADR 0001：Supabase 接続前は端末内のモックDBで全画面を動かす

- 状態：採用（2026-10-01）

## 背景

Vercel と Supabase に接続する前に、要件定義書の画面・操作・状態をすべて確認できる状態にしたい。接続後に画面を作り直さずに済むよう、データの読み書きの入口を1つにしたい。

## 決定

- 画面は `src/lib/api` の `api` だけを使い、直接 Supabase を呼ばない。
- 接続前の実装は `src/lib/api/mock/`。16章のテーブルを端末内（localStorage）に持ち、RLS とサーバー関数が行う検査（利用制限、ブロック、レート制限、1人1アカウント）も同じ規則で再現する。
- Supabase 側の正本は `supabase/migrations/`。同じ規則を RLS と RPC で強制し、`npm run db:verify` で検証する。
- 接続後は `Api` 型を満たす Supabase 実装に差し替える（`docs/supabase-setup.md` の対応表）。

## 影響

- デモ・デザインレビュー・受け入れテスト（Playwright）を接続前から回せる。
- モックと DB の規則が二重になる。差し替え後はモックを削除し、規則は DB 側だけにする。

## その後（2026-10-05）

- Supabase 実装（`src/lib/api/supabase/`）を追加した。モックと同じ `Api` 型を満たすことを型検査で確かめている。
- どちらを使うかはビルド時に決める（Supabase の URL と公開鍵があれば Supabase）。`vite.config.ts` の別名 `@impl` で片方だけを本番の JavaScript に含める。
- モックはデモ・デザインレビュー・高速な受け入れテストのために残す。本番の規則の正本は DB（RLS・RPC）で、`e2e-supabase/` と `supabase/tests/local/verify.sql` で本物の Supabase に対して確かめる。
