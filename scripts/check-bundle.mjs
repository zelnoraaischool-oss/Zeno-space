/**
 * 18.1 初回に読み込む JavaScript を gzip 後 200KB 以下に保つ。超えたら失敗させる（CI）。
 * dist/index.html が最初に読み込む script と modulepreload の合計を測る。
 */
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const LIMIT = 200 * 1024
const html = readFileSync('dist/index.html', 'utf8')
const files = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1])
let total = 0
for (const f of new Set(files)) {
  const size = gzipSync(readFileSync(`dist${f}`)).length
  total += size
  console.log(`${(size / 1024).toFixed(1).padStart(7)} KB  ${f}`)
}
console.log(`${(total / 1024).toFixed(1).padStart(7)} KB  合計（上限 ${LIMIT / 1024} KB）`)
if (total > LIMIT) {
  console.error('初回に読み込む JavaScript が上限を超えています')
  process.exit(1)
}
