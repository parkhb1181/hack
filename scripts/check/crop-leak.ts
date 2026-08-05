/**
 * 조각 유출 점검 — `npx tsx scripts/check/crop-leak.ts <이름...>`
 *
 * `MODELS.md` §2.2는 "조각에는 대화 글자가 없으므로 대화 내용이 외부로 나가지
 * 않는다"고 적혀 있다. 그런데 `/crop`은 `im.crop((0, top, w, bottom))` —
 * **가로 전체**를 자른다. 구간 안에 이름표나 본문 줄이 걸리면 그대로 나간다.
 *
 * 여기서는 실제 OCR 줄 좌표를 구간과 대조해 **무엇이 함께 잘려 나가는지** 센다.
 * 내용은 마스킹해서 출력한다 — 점검 로그가 유출 경로가 되면 안 된다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { findHoles, groupBubbles, isUiGlyph, type OcrPage } from '@/lib/parsers/ocr'

const names = process.argv.slice(2)
if (names.length === 0) {
  console.error('사용: npx tsx scripts/check/crop-leak.ts mom_01 mom_02 ...')
  process.exit(1)
}

/** 글자 수만 남기고 지운다 */
const mask = (s: string) => `${s.length}자 "${s.slice(0, 1)}…"`

let totalHoles = 0
let leaky = 0

for (const name of names) {
  const page = JSON.parse(
    readFileSync(join(process.cwd(), 'fixtures', 'real', `${name}.ocr.json`), 'utf8'),
  ) as OcrPage

  const bubbles = groupBubbles(page)
  const holes = findHoles(page, bubbles)

  console.log(`\n━━ ${name}  ${page.width}×${page.height} · 줄 ${page.lines.length} · 말풍선 ${bubbles.length} · 구간 ${holes.length}`)

  for (const h of holes) {
    totalHoles++
    const [y0, y1] = h.y
    // 세로로 구간 안에 들어오는 줄 = 조각에 같이 찍혀 나가는 글자
    const inside = page.lines.filter((l) => {
      if (isUiGlyph(l.text)) return false // 아이콘은 지킬 글자가 아니다
      const cy = (l.box[1] + l.box[3]) / 2
      return cy > y0 && cy < y1
    })
    const flag = inside.length > 0 ? '⚠' : ' '
    if (inside.length > 0) leaky++
    console.log(
      `  ${flag} y ${String(y0).padStart(4)}~${String(y1).padStart(4)} (${String(y1 - y0).padStart(3)}px, ${h.who}) → 동봉 ${inside.length}줄` +
        (inside.length ? `: ${inside.map((l) => mask(l.text)).join(', ')}` : ''),
    )
  }
}

console.log(`\n구간 ${totalHoles}개 중 글자가 함께 나가는 것 ${leaky}개`)

