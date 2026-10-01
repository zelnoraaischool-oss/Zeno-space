# ADR 0003：利用制限と権限はデータベースで強制する

- 状態：採用（2026-10-01）

## 決定

- 全テーブルで RLS を有効にし、既定は拒否（18.3）。
- 利用制限は `restrictions` を `private.has_restriction()` で参照し、`messages` の insert ポリシーと `send_message()` RPC の両方で拒否する。画面を経由しない送信も止まる（ZS-ADM-03）。
- 運営の権限は `admin_members` のロールに加え、JWT の `aal = aal2`（TOTP 済み）を必須にする（3.2）。
- 監査ログ（`audit_logs`）は insert/update/delete の権限を誰にも与えず、`private.audit()` とトリガーだけが追記する（ZS-ADM-25）。
- 運営はユーザー間のトーク本文を読めない。読めるのは公式アカウント宛てのメッセージと、通報者が同意して提供した写し（`reports.shared_messages`）だけ（19.1）。

## 検証

`supabase/tests/local/verify.sql`（素の PostgreSQL）で主要な規則を確かめる。接続後は `supabase test db`（pgTAP）に移す。
