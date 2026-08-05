/** OCR 서비스 왕복 실측 — `npx tsx scripts/bench/ocr-service.ts <이름...>` */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const URL_ = process.env.OCR_SERVICE_URL ?? 'http://127.0.0.1:8756'
const names = process.argv.slice(2)

for (const n of names) {
  const buf = readFileSync(join(process.cwd(), 'fixtures', 'real', `${n}.png`))
  const fd = new FormData()
  fd.append('file', new Blob([new Uint8Array(buf)], { type: 'image/png' }), `${n}.png`)
  const t0 = Date.now()
  const res = await fetch(`${URL_}/ocr`, { method: 'POST', body: fd })
  const j = (await res.json()) as { lines?: unknown[]; elapsed_sec?: number }
  console.log(
    `${n}  왕복 ${Date.now() - t0}ms · 서버측 ${j.elapsed_sec ?? '?'}초 · ${j.lines?.length ?? 0}줄`,
  )
}
