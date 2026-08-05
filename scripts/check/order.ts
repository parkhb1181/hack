/**
 * 캡처를 순서 섞어 넣으면 어떻게 되나 — `npx tsx scripts/check/order.ts`
 *
 * 겹침 병합(`mergeMessages`)은 **스크롤 순서를 가정한다.** 앞 장의 꼬리와
 * 뒷 장의 머리가 겹친다는 전제로 붙이기 때문이다. 순서가 섞이면 그 전제가
 * 깨지는데, 그때 **조용히 틀린 답이 나오는지** 아니면 티가 나는지를 본다.
 *
 * 캡처는 `ts`가 없다. 시간축으로 되돌릴 수단이 없으니 순서가 곧 결과다 —
 * 버스트·세션·전환 쌍·선톡이 전부 순서에서 나온다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildCorpus } from '@/lib/corpus'
import { mergeMessages, orderPages, toMessages, type OcrPage } from '@/lib/parsers/ocr'
import { buildReport, isHardFloor } from '@/lib/report'
import type { Msg } from '@/lib/types'

const NAMES = ['mom_01', 'mom_02', 'mom_03']

const pages: Record<string, Msg[]> = {}
for (const n of NAMES) {
  const page = JSON.parse(
    readFileSync(join(process.cwd(), 'fixtures', 'real', `${n}.ocr.json`), 'utf8'),
  ) as OcrPage
  pages[n] = toMessages(page).messages
}

function run(order: string[]) {
  const merged = mergeMessages(
    order.map((n) => pages[n]),
    order,
  )
  const corpus = buildCorpus(merged.messages, { mode: 'capture', gaps: merged.gaps })
  const report = buildReport(corpus)
  return {
    order: order.map((n) => n.slice(-2)).join('→'),
    msgs: merged.messages.length,
    removed: merged.removed.reduce((a, b) => a + b, 0),
    breaks: merged.gaps.filter((g) => g.startsWith('scroll_break')).length,
    tilt: isHardFloor(report) ? null : report.headline.tilt,
    // 순서가 결과에 실제로 닿는지 보려면 앞 세 발화의 화자를 본다
    head: merged.messages.slice(0, 3).map((m) => (m.who === 'me' ? '나' : '상')).join(''),
  }
}

const ORDERS = [
  ['mom_01', 'mom_02', 'mom_03'],
  ['mom_03', 'mom_02', 'mom_01'],
  ['mom_02', 'mom_01', 'mom_03'],
  ['mom_03', 'mom_01', 'mom_02'],
]

console.log('■ 실물 캡처 3장 (겹침 없음)\n')
console.log(`${'순서'.padEnd(12)}${'메시지'.padStart(7)}${'중복제거'.padStart(9)}${'끊김'.padStart(6)}${'기울기'.padStart(7)}   앞3`)
console.log('─'.repeat(52))
for (const o of ORDERS) {
  const r = run(o)
  console.log(
    `${r.order.padEnd(12)}${String(r.msgs).padStart(7)}${String(r.removed).padStart(9)}` +
      `${String(r.breaks).padStart(6)}${String(r.tilt ?? '—').padStart(7)}   ${r.head}`,
  )
}

/* ------------------------------------------------------------------ *
 * 겹침이 **있을 때**가 진짜 문제다.
 *
 * 위 3장은 겹침이 0이라 순서를 바꿔도 같은 22건이 나왔다. 병합이 할 일이
 * 없었을 뿐이다. 스크롤하며 겹치게 찍은 경우를 만들어 다시 본다.
 * ------------------------------------------------------------------ */

const all = [...pages.mom_01, ...pages.mom_02].map((m, seq) => ({ ...m, seq }))
const cut = Math.floor(all.length / 2)
const OVERLAP = 4
// A: 앞부분, B: 뒷부분 — 가운데 OVERLAP개가 겹친다
const A = all.slice(0, cut + OVERLAP).map((m, seq) => ({ ...m, seq }))
const B = all.slice(cut).map((m, seq) => ({ ...m, seq }))

function merged(pgs: Msg[][]) {
  const r = mergeMessages(pgs, ['A', 'B'])
  return {
    n: r.messages.length,
    removed: r.removed.reduce((a, b) => a + b, 0),
    breaks: r.gaps.filter((g) => g.startsWith('scroll_break')).length,
  }
}

console.log(`\n■ 겹치게 찍은 2장 (원본 ${all.length}건, 겹침 ${OVERLAP}건)\n`)
const right = merged([A, B])
const wrong = merged([B, A])
console.log(`  바른 순서 A→B   ${right.n}건 · 중복 제거 ${right.removed} · 끊김 ${right.breaks}`)
console.log(`  뒤집힌 B→A     ${wrong.n}건 · 중복 제거 ${wrong.removed} · 끊김 ${wrong.breaks}`)

/* ── 자동 정렬이 이걸 바로잡는가 ─────────────────────────────── */

console.log('\n■ 겹침으로 자동 정렬 (orderPages)\n')

const cases: Array<[string, Msg[][]]> = [
  ['A→B (이미 바름)', [A, B]],
  ['B→A (뒤집힘)', [B, A]],
]
for (const [label, pgs] of cases) {
  const o = orderPages(pgs)
  const m = mergeMessages(
    o.order.map((i) => pgs[i]),
    o.order.map((i) => String(i)),
  )
  console.log(
    `  ${label.padEnd(16)} → 순서 [${o.order.join(',')}] · 겹침 ${o.score} · ` +
      `${m.messages.length}건 · 재배열 ${o.reordered ? 'O' : 'X'}`,
  )
}

// 3장 이상도 되는지 — 겹치게 셋으로 자른 뒤 뒤죽박죽 넣는다
const t = Math.floor(all.length / 3)
const P = [
  all.slice(0, t + 3),
  all.slice(t, 2 * t + 3),
  all.slice(2 * t),
].map((p) => p.map((m, seq) => ({ ...m, seq })))

const shuffled = [P[2], P[0], P[1]]
const o3 = orderPages(shuffled)
const m3 = mergeMessages(
  o3.order.map((i) => shuffled[i]),
  o3.order.map((i) => String(i)),
)
const base = mergeMessages(P, ['0', '1', '2'])
console.log(
  `\n  3장 뒤죽박죽 [2,0,1] → 순서 [${o3.order.join(',')}] · ${m3.messages.length}건` +
    `  (바른 순서로 넣었을 때 ${base.messages.length}건)`,
)
console.log(`  일치: ${m3.messages.length === base.messages.length ? '예 ✓' : '아니오 ✗'}`)

// 겹침이 없으면 손대지 않아야 한다
const noOverlap = orderPages([pages.mom_01, pages.mom_02, pages.mom_03])
console.log(
  `\n  겹침 없는 3장 → 재배열 ${noOverlap.reordered ? 'O (문제)' : 'X ✓ 손대지 않음'}`,
)
