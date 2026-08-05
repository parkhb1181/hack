/**
 * 처리 단계 스트리밍 확인 — `npx tsx scripts/check/stream.ts <파일>`
 *
 * 처리 화면은 **실제 진행**을 받아야 한다. 시간 기반 연출로 만들면 OCR이
 * 20초 걸리는데 화면은 3초에 끝난 것처럼 보인다. 여기서는 이벤트가 언제
 * 도착하는지를 찍어서, 화면이 채울 수 있는 시간인지 확인한다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.APP_URL ?? 'http://localhost:3000'
const args = process.argv.slice(2)
const names = args.filter((a) => !a.startsWith('--'))
if (names.length === 0) {
  console.error('사용: npx tsx scripts/check/stream.ts <파일|캡처이름...>')
  process.exit(1)
}

const fd = new FormData()
const asText = names.find((n) => /\.(txt|csv)$/i.test(n))
if (asText) {
  const p = asText.includes('/') || asText.includes('\\') ? asText : join('fixtures', 'real', asText)
  fd.append('file', new Blob([readFileSync(p)], { type: 'text/plain' }), p.split(/[\\/]/).pop())
} else {
  for (const n of names) {
    fd.append(
      'images',
      new Blob([new Uint8Array(readFileSync(join('fixtures', 'real', `${n}.png`)))], {
        type: 'image/png',
      }),
      `${n}.png`,
    )
  }
}
fd.append('stage', 'crush')
const meArg = args.find((a) => a.startsWith('--me='))
if (meArg) fd.append('me', meArg.slice(5))

const t0 = Date.now()
const res = await fetch(`${BASE}/api/analyze`, { method: 'POST', body: fd })
console.log(`${res.status} ${res.headers.get('content-type')}\n`)

const reader = res.body!.getReader()
const dec = new TextDecoder()
let buf = ''

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buf += dec.decode(value, { stream: true })
  const lines = buf.split('\n')
  buf = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.trim()) continue
    const e = JSON.parse(line) as Record<string, unknown>
    const at = `+${((Date.now() - t0) / 1000).toFixed(1)}초`.padStart(8)
    if (e.type === 'stage') {
      console.log(`${at}  ${String(e.key).padEnd(7)} ${String(e.state).padEnd(5)} ${e.detail ?? ''}`)
    } else if (e.type === 'error') {
      console.log(`${at}  ✗ ${e.status} ${e.error}`)
    } else {
      const r = e as { hardFloor?: boolean; odds?: Array<{ label: string; percent: number }> }
      console.log(`${at}  ■ 결과 도착 (하드플로어 ${r.hardFloor ? 'Y' : 'N'})`)
      for (const o of r.odds ?? []) console.log(`         ${o.label} ${o.percent}`)
    }
  }
}
console.log(`\n총 ${((Date.now() - t0) / 1000).toFixed(1)}초`)
