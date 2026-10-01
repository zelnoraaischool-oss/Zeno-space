#!/usr/bin/env bash
# Supabase 接続前に、素の PostgreSQL でマイグレーションと RLS を検証する。
#   使い方：PGHOST=... PGPORT=... PGUSER=postgres scripts/verify-migrations.sh
# PGroonga（0005）と pg_cron / pg_net / Vault（0007）は素の PostgreSQL に無いため構文チェックのみ。
# 本番相当の確認は Supabase 接続後に `supabase db reset` と `supabase test db` で行う。
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${VERIFY_DB:-zenospace_verify}
psql -v ON_ERROR_STOP=1 -q -c "drop database if exists $DB" -c "create database $DB" postgres
run() { psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$1"; }
run supabase/tests/local/shim.sql
for f in supabase/migrations/*.sql; do
  case "$f" in
    *_search.sql|*_cron.sql) echo "skip (needs Supabase extensions): $f" ;;
    *) echo "apply: $f"; run "$f" ;;
  esac
done
echo "seed: supabase/seed.sql"; run supabase/seed.sql
run supabase/tests/local/verify.sql
[ -n "${KEEP_DB:-}" ] || psql -q -c "drop database $DB" postgres
