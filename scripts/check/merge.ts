/**
 * 겹침 제거 실물 검증 — `npx tsx scripts/check/merge.ts <접두사> <장수>`
 *
 * TESTPLAN §1.2가 요구하는 "겹침이 실제로 몇 개인지 세기" + SPEC §4.2 검증.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mergeMessages, messageKey, toMessages, type OcrPage } from '@/lib/parsers/ocr'
import type { Msg } from '@/lib/types'

const prefix = process.argv[2] ?? 'group'
const count = Number(process.argv[3] ?? 4)
const dir = join(process.cwd(), 'fixtures', 'real')

const pages: Msg[][] = []
const labels: string[] = []

console.log('■ 장별 파싱')
for (let i = 1; i <= count; i++) {
  const name = `${prefix}_${String(i).padStart(2, '0')}`
  const page = JSON.parse(readFileSync(join(dir, `${name}.ocr.json`), 'utf8')) as OcrPage
  const r = toMessages(page)
  labels.push(name)
  pages.push(r.messages)
  const types = r.messages.reduce<Record<string, number>>((a, m) => {
    a[m.type] = (a[m.type] ?? 0) + 1
    return a
  }, {})
  console.log(
    `  ${name}  화자 ${r.speakers}명${r.rejected ? ` (${r.rejected})` : ''}  말풍선 ${r.messages.length}개  [${Object.entries(types).map(([k, v]) => `${k}=${v}`).join(' ')}]`,
  )
}

const naive = pages.reduce((n, p) => n + p.length, 0)
const merged = mergeMessages(pages, labels)

console.log('\n■ 겹침 제거')
console.log(`  단순 이어붙임  ${naive}개`)
console.log(`  겹침 제거 후   ${merged.messages.length}개`)
merged.removed.forEach((n, i) => {
  console.log(`  ${labels[i]} → ${labels[i + 1]}   겹침 ${n}개${n === 0 ? '  ✗ 못 찾음' : ''}`)
})
if (merged.gaps.length) console.log(`  gaps: ${merged.gaps.join(', ')}`)

const dup = naive - merged.messages.length
console.log(`  중복 제거      ${dup}개 (${((dup / naive) * 100).toFixed(1)}%)`)

// 병합이 실제로 옳았는지 — 최종 배열에 같은 키가 연속으로 남아 있으면 실패
const keys = merged.messages.map(messageKey)
const repeats = keys.filter((k, i) => i > 0 && k === keys[i - 1]).length
console.log(`  인접 중복 잔존 ${repeats}개  ${repeats === 0 ? '✅' : '❌'}`)

// 전체 중복(비인접 포함) — 같은 말을 두 번 한 경우도 있어 참고값
const seen = new Set<string>()
let anyDup = 0
for (const k of keys) {
  if (seen.has(k)) anyDup += 1
  seen.add(k)
}
console.log(`  동일 키 재등장 ${anyDup}개 (같은 말 반복 포함이라 0이 아닐 수 있음)`)

console.log('\n■ 병합 결과 앞뒤 (내용 확인용, 각 3개)')
const show = (m: Msg) =>
  `${m.who === 'me' ? '나  ' : '상대'} ${(m.time ?? '  -  ').padEnd(6)} ${(m.text ?? `[${m.type}]`).replace(/\n/g, ' ⏎ ').slice(0, 34)}`
for (const m of merged.messages.slice(0, 3)) console.log(`  ${show(m)}`)
console.log('  …')
for (const m of merged.messages.slice(-3)) console.log(`  ${show(m)}`)
