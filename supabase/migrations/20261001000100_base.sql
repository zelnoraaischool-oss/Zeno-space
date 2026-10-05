-- =============================================================================
-- zenospace 0001: 拡張・スキーマ・共通関数
-- 16.2 設計ルール：主キーは UUID（messages のみ bigint）、日時は timestamptz（UTC）、
-- 削除は deleted_at による論理削除、全テーブルで RLS を有効にし既定は拒否。
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- クライアントに公開しない関数・内部テーブルを置くスキーマ
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
-- private の関数は既定で誰も実行できない（RLS で使う判定関数だけ 0003 で許可する）
alter default privileges in schema private revoke execute on functions from public;

-- ZS-ONE-02 メールの正規化（小文字化、Gmail はドットと「+」以降を除く）
-- src/lib/normalize.ts の normalizeEmail() と同じ規則
create or replace function private.normalize_email(raw text)
returns text
language plpgsql
immutable
as $$
declare
  e text := lower(btrim(coalesce(raw, '')));
  local_part text;
  domain_part text;
begin
  if position('@' in e) < 2 then
    return e;
  end if;
  local_part := split_part(e, '@', 1);
  domain_part := split_part(e, '@', 2);
  if domain_part = 'googlemail.com' then
    domain_part := 'gmail.com';
  end if;
  local_part := split_part(local_part, '+', 1);
  if domain_part = 'gmail.com' then
    local_part := replace(local_part, '.', '');
  end if;
  return local_part || '@' || domain_part;
end;
$$;

-- 識別子のハッシュ（identity_keys.value_hash / device_hashes.device_hash）
create or replace function private.hash_identity(v text)
returns text
language sql
immutable
as $$
  select encode(extensions.digest(convert_to(v, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
