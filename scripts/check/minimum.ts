/**
 * 결과가 나오기 시작하는 최소 대화량 — `npx tsx scripts/check/minimum.ts`
 *
 * 문턱이 둘이라 계산만으로는 안 나온다.
 *   1) 정보 단위 ≥ 하드 플로어 (SPEC §6.2)
 *   2) 헤드라인 축이 최소 1개 OK — 지표마다 최소 표본이 따로 있다 (§5.2)
 *
 * 앞에서부터 한 건씩 늘려가며 각 문턱을 언제 넘는지 찍는다.
 */

import { buildCorpus } from '@/lib/corpus'
import { buildReport, isHardFloor } from '@/lib/report'
import { HARD_FLOOR } from '@/lib/stats/sample'
import { generateCaptureSeed } from '@/lib/seed/capture'
import { isUnsupported, parseTxt, resolveWho, toMessages } from '@/lib/parsers/txt'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Msg, Report } from '@/lib/types'

function txtMsgs(name: string): Msg[] {
  const raw = readFileSync(join(process.cwd(), 'fixtures', 'seeds', `${name}.pc.txt`), 'utf8')
  const p = parseTxt(raw)
  if (isUnsupported(p)) throw new Error('형식 미지원')
  return toMessages(p.raw, resolveWho(p.title, p.speakers).map)
}

type Case = { label: string; msgs: Msg[]; mode: 'capture' | 'txt' }

const CASES: Case[] = [
  { label: '균형 (캡처)', msgs: generateCaptureSeed('cap_balanced'), mode: 'capture' },
  { label: '일방적 (캡처)', msgs: generateCaptureSeed('cap_onesided_me'), mode: 'capture' },
  { label: '균형 (txt)', msgs: txtMsgs('seed_balanced'), mode: 'txt' },
]

console.log(`하드 플로어 ${HARD_FLOOR}\n`)
console.log('대화              리포트 시작   그때 축   정밀도 정상   최대 축   평균 정보/건')

for (const c of CASES) {
  let firstAt: number | null = null
  let firstAxes = 0
  let fullPrecAt: number | null = null
  let maxAxes = 0
  let axesTotal = 0

  for (let n = 2; n <= c.msgs.length; n++) {
    const corpus = buildCorpus(c.msgs.slice(0, n), { mode: c.mode })
    const r = buildReport(corpus)
    if (isHardFloor(r)) continue
    const h = (r as Report).headline
    axesTotal = h.axesTotal
    maxAxes = Math.max(maxAxes, h.axesUsed)
    if (firstAt == null) {
      firstAt = n
      firstAxes = h.axesUsed
    }
    // 표본이 얇으면 숫자를 숨기고 밴드만 보여준다 — SPEC §6.4
    if (fullPrecAt == null && !h.precisionReduced) fullPrecAt = n
  }

  const full = buildCorpus(c.msgs, { mode: c.mode })
  const per = (full.infoUnits / c.msgs.length).toFixed(2)

  console.log(
    `${c.label.padEnd(17)} ${String(firstAt ?? '—').padStart(8)}건 ${String(firstAxes).padStart(7)}축 ` +
      `${String(fullPrecAt ?? '—').padStart(10)}건 ${String(maxAxes).padStart(8)}/${axesTotal}축  ${per}`,
  )
}

console.log('\n─ 가중치별 이론 최소 (SPEC §6.1) ─')
const W: Array<[string, number]> = [
  ['전부 10자 이상', 1.0],
  ['전부 3~9자', 0.7],
  ['전부 2자 이하', 0.4],
  ['전부 이모티콘(정서 판독됨)', 1.2],
]
for (const [label, w] of W) {
  console.log(`  ${label.padEnd(26)} ${Math.ceil(HARD_FLOOR / w)}건`)
}
