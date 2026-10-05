/**
 * supabase/migrations/*.sql をデータベースに適用する（まだ適用していないものだけ、ファイル名の順に）。
 *
 * Vercel の本番ビルドで自動的に動く（vercel.json の buildCommand）。接続先は Vercel の Supabase 連携が入れる
 * POSTGRES_URL_NON_POOLING（または SUPABASE_DB_URL / DATABASE_URL）。
 * 適用済みの記録は Supabase CLI と同じ supabase_migrations.schema_migrations に残すので、`supabase db push` と併用できる。
 *
 *   使い方：node scripts/migrate.mjs            … 本番ビルド（VERCEL_ENV=production）のときだけ適用
 *          MIGRATE=1 node scripts/migrate.mjs   … いつでも適用（手元から本番へ流すときなど）
 *          MIGRATE=0                           … 適用しない
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const dir = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
const env = process.env
const url = env.SUPABASE_DB_URL || env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL

const forced = env.MIGRATE === '1'
const disabled = env.MIGRATE === '0'
// プレビュー（ブランチ）のビルドでは流さない：まだレビュー前のマイグレーションを本番のDBに入れないため
const isProductionBuild = env.VERCEL_ENV === 'production'

if (disabled || (!forced && !isProductionBuild)) {
  console.log('[migrate] 本番ビルドではないため、マイグレーションは適用しません（MIGRATE=1 で強制）')
  process.exit(0)
}
if (!url) {
  console.log('[migrate] データベースの接続先（POSTGRES_URL_NON_POOLING など）が無いため、マイグレーションは適用しません')
  process.exit(0)
}

const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url)
const sql = postgres(url, {
  ssl: local ? false : 'require',
  max: 1,
  onnotice: () => {},
  connect_timeout: 30,
  // Supabase の接続プーラー（Supavisor）経由でも動くように、名前付きの準備文を使わない
  prepare: false,
})

try {
  await sql`select pg_advisory_lock(727274)`
  await sql.unsafe(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text not null primary key);
    alter table supabase_migrations.schema_migrations add column if not exists statements text[];
    alter table supabase_migrations.schema_migrations add column if not exists name text;
  `)
  const applied = new Set((await sql`select version from supabase_migrations.schema_migrations`).map((r) => r.version))
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
  let count = 0
  for (const file of files) {
    const [version, ...rest] = file.replace(/\.sql$/, '').split('_')
    if (applied.has(version)) continue
    const body = readFileSync(dir + file, 'utf8')
    process.stdout.write(`[migrate] ${file} … `)
    await sql.begin(async (tx) => {
      await tx.unsafe(body)
      await tx`insert into supabase_migrations.schema_migrations (version, name, statements) values (${version}, ${rest.join('_')}, ${[body]})`
    })
    console.log('ok')
    count++
  }
  console.log(count ? `[migrate] ${count} 件を適用しました` : '[migrate] 適用するマイグレーションはありません')
} catch (e) {
  console.error('\n[migrate] マイグレーションに失敗しました。デプロイを止めます。')
  console.error(e)
  process.exitCode = 1
} finally {
  await sql`select pg_advisory_unlock(727274)`.catch(() => {})
  await sql.end({ timeout: 5 })
}
