/**
 * OCR 결과를 정답지와 대조한다 — `npx tsx scripts/check/ocr.ts <이름>`
 *
 * TESTPLAN §1.2의 "결과 육안 검증"을 자동화한 것이다.
 * 좌우 / 시각 / 본문을 각각 따로 채점해서 어디가 깨지는지 보이게 한다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { groupBubbles, findHoles, toMessages, type OcrPage } from '@/lib/parsers/ocr'
import type { Who } from '@/lib/types'

type Truth = { who: Who; type: string; text: string | null; time: string | null }

const name = process.argv[2] ?? 'kakao_yellow'
// 실물은 fixtures/real, 렌더는 fixtures/render. 정답지 위치도 다르다
const real = process.argv[3] === '--real'
const dir = join(process.cwd(), 'fixtures', real ? 'real' : 'render')

const page = JSON.parse(
  readFileSync(join(dir, `${name}.ocr.json`), 'utf8'),
) as OcrPage & { elapsed_sec?: number }
const truth = JSON.parse(
  readFileSync(join(dir, real ? `${name}.truth.json` : 'truth.json'), 'utf8'),
) as Truth[]

const norm = (s: string) => s.replace(/\s+/g, '').trim()

console.log(`=== ${name} ===`)
console.log(`OCR ${page.lines.length}줄 · ${page.elapsed_sec ?? '?'}초 · ${page.width}x${page.height}\n`)

const bubbles = groupBubbles(page)
const holes = findHoles(page, bubbles)
const result = toMessages(page)

console.log(`화자 ${result.speakers}명 · 말풍선 ${bubbles.length}개 · 비텍스트 구간 ${holes.length}개`)
if (result.rejected) console.log(`거절: ${result.rejected}`)

const expected = truth.filter((t) => t.type === 'text')
console.log(`\n정답지 텍스트 ${expected.length}개 (스티커 ${truth.length - expected.length}개 별도)\n`)

console.log('OCR 결과')
console.log('─'.repeat(78))
for (const m of result.messages) {
  const side = m.who === 'me' ? '나  ' : '상대'
  const t = (m.time ?? '  -  ').padEnd(6)
  console.log(`${side} ${t} ${(m.text ?? '').replace(/\n/g, ' ⏎ ')}`)
}

// 채점 — 본문 텍스트가 정답지에 있는지 (공백 무시)
let textHit = 0
for (const e of expected) {
  const want = norm(e.text ?? '')
  if (result.messages.some((m) => norm(m.text ?? '') === want)) textHit += 1
}

// 좌우 정확도 — 매칭된 것만
let sideHit = 0
let sideTotal = 0
for (const e of expected) {
  const want = norm(e.text ?? '')
  const got = result.messages.find((m) => norm(m.text ?? '') === want)
  if (!got) continue
  sideTotal += 1
  if (got.who === e.who) sideHit += 1
}

// 시각 — 정답지에 시각이 있는 메시지만
const timed = expected.filter((e) => e.time)
let timeHit = 0
for (const e of timed) {
  const want = norm(e.text ?? '')
  const got = result.messages.find((m) => norm(m.text ?? '') === want)
  if (got && got.time === e.time) timeHit += 1
}

const pct = (a: number, b: number) => (b === 0 ? '—' : `${Math.round((a / b) * 100)}%`)

console.log('\n채점')
console.log('─'.repeat(78))
console.log(`본문 일치     ${textHit}/${expected.length}  ${pct(textHit, expected.length)}`)
console.log(`좌우 판정     ${sideHit}/${sideTotal}  ${pct(sideHit, sideTotal)}`)
console.log(`시각 부착     ${timeHit}/${timed.length}  ${pct(timeHit, timed.length)}`)
console.log(`스티커 검출   ${holes.length}/${truth.length - expected.length}`)

const missed = expected.filter((e) => {
  const want = norm(e.text ?? '')
  return !result.messages.some((m) => norm(m.text ?? '') === want)
})
if (missed.length) {
  console.log('\n놓친 본문')
  for (const m of missed) console.log(`  ✗ ${m.text?.replace(/\n/g, ' ⏎ ')}`)
}
