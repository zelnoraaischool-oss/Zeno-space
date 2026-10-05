#!/usr/bin/env bash
# マイグレーションを本物の Supabase（ローカル：`npx supabase start` で起動したもの）に流し直し、
# 1人1アカウント・RLS・制限の強制・監査ログを SQL で検証する（supabase/tests/local/verify.sql）。
#   使い方：npx supabase start && npm run db:verify
set -euo pipefail
cd "$(dirname "$0")/.."
npx supabase db reset
PGPASSWORD=${PGPASSWORD:-postgres} psql -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-54322}" -U "${PGUSER:-postgres}" -d postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/local/verify.sql
