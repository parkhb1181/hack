/**
 * 퍼센트가 얼마나 벌어지는지 — `npx tsx scripts/check/spread.ts`
 *
 * "뭘 넣든 50%에 수렴한다"는 인상을 숫자로 확인한다. 각 축이 이미 0.5 근처
 * 비율이라, 여럿을 가중 평균하면 더 세게 중앙으로 끌린다(평균으로의 회귀).
 * 대화별로 값이 안 갈리면 카드가 아무 말도 못 하는 것과 같다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildCorpus } from '@/lib/corpus'
import { isCsvFailure, parseCsv } from '@/lib/parsers/csv'
import { isUnsupported, parseTxt, resolveWho, toMessages, type ParseResult } from '@/lib/parsers/txt'
import { buildReport, isHardFloor } from '@/lib/report'
import { computeOdds } from '@/lib/stats/odds'

type Case = { label: string; path: string; me?: string }

const CASES: Case[] = [
  { label: '시드 일방적', path: 'fixtures/seeds/seed_onesided.pc.txt' },
  { label: '시드 균형', path: 'fixtures/seeds/seed_balanced.pc.txt' },
  { label: '시드 식음', path: 'fixtures/seeds/seed_faded.pc.txt' },
  { label: '데모 썸', path: 'fixtures/seeds/demo_crush.txt' },
  { label: '실물 iOS 24h', path: 'fixtures/real/ios_export.txt' },
  { label: '실물 iOS 오후', path: 'fixtures/real/ios_ampm.txt' },
]

const rows: Array<[string, number, number, number]> = []

for (const c of CASES) {
  let body: string
  try {
    body = readFileSync(join(process.cwd(), c.path), 'utf8')
  } catch {
    continue
  }

  let p: ParseResult
  if (/\.csv$/i.test(c.path)) {
    const r = parseCsv(body)
    if (isCsvFailure(r)) continue
    p = r
  } else {
    const r = parseTxt(body)
    if (isUnsupported(r)) continue
    p = r
  }

  const who = resolveWho(p.title, p.speakers, c.me)
  if (!who.resolved) {
    console.log(`${c.label.padEnd(14)} 본인 미확정 — 건너뜀`)
    continue
  }

  const corpus = buildCorpus(toMessages(p.raw, who.map), {
    mode: 'txt',
    source: p.source,
    deleted: p.deleted,
  })
  const report = buildReport(corpus)
  if (isHardFloor(report)) {
    console.log(`${c.label.padEnd(14)} 하드 플로어`)
    continue
  }

  const odds = computeOdds(report)
  const recip = odds.find((o) => o.key === 'reciprocity')?.percent ?? 50
  const mom = odds.find((o) => o.key === 'momentum')?.percent ?? 50
  rows.push([c.label, report.headline.tilt, recip, mom])
}

console.log(`\n${'대화'.padEnd(16)}${'기울기'.padStart(7)}${'상대 마음'.padStart(11)}${'더 이어질'.padStart(11)}`)
console.log('─'.repeat(46))
for (const [l, t, r, m] of rows) {
  console.log(`${l.padEnd(16)}${String(t).padStart(7)}${r.toFixed(1).padStart(11)}${m.toFixed(1).padStart(11)}`)
}

const spread = (xs: number[]) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0)
console.log('─'.repeat(46))
console.log(
  `${'퍼짐(최대-최소)'.padEnd(16)}${String(spread(rows.map((r) => r[1]))).padStart(7)}` +
    `${spread(rows.map((r) => r[2])).toFixed(1).padStart(11)}` +
    `${spread(rows.map((r) => r[3])).toFixed(1).padStart(11)}`,
)
