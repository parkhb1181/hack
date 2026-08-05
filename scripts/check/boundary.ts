/** 인접 캡처의 경계를 나란히 본다 — `npx tsx scripts/check/boundary.ts <접두사> <장수>` */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { groupBubbles, messageKey, prepareLines, type OcrPage } from '@/lib/parsers/ocr'

const prefix = process.argv[2] ?? 'group'
const count = Number(process.argv[3] ?? 4)
const dir = join(process.cwd(), 'fixtures', 'real')

/** 단톡 거절을 우회하고 말풍선만 본다 — 병합 알고리즘 자체를 보려는 것 */
function bubblesOf(name: string) {
  const page = JSON.parse(readFileSync(join(dir, `${name}.ocr.json`), 'utf8')) as OcrPage
  return groupBubbles(page).map((b) => ({
    who: b.who,
    time: b.time,
    text: b.lines.map((l) => l.text.trim()).join(' ⏎ '),
  }))
}

const pages = Array.from({ length: count }, (_, i) =>
  bubblesOf(`${prefix}_${String(i + 1).padStart(2, '0')}`),
)

pages.forEach((p, i) => console.log(`${prefix}_${i + 1}: 말풍선 ${p.length}개`))

const show = (b: { who: string; time: string | null; text: string }) =>
  `${b.who === 'me' ? '나  ' : '상대'} ${(b.time ?? '  -  ').padEnd(6)} ${b.text.slice(0, 40)}`

for (let i = 0; i < pages.length - 1; i++) {
  console.log(`\n── ${prefix}_${i + 1} 끝 ↔ ${prefix}_${i + 2} 처음 ──`)
  console.log('  [앞 장 마지막 5]')
  for (const b of pages[i].slice(-5)) console.log(`    ${show(b)}`)
  console.log('  [뒤 장 처음 5]')
  for (const b of pages[i + 1].slice(0, 5)) console.log(`    ${show(b)}`)

  // 텍스트만으로 겹치는 게 있는지 (시각·화자 무시)
  const tail = new Set(pages[i].slice(-12).map((b) => b.text.replace(/\s+/g, '')))
  const head = pages[i + 1].slice(0, 12).map((b) => b.text.replace(/\s+/g, ''))
  const common = head.filter((t) => t.length > 3 && tail.has(t))
  console.log(`  → 텍스트 기준 공통 ${common.length}개${common.length ? ': ' + common.slice(0, 3).join(' / ') : ''}`)
}
