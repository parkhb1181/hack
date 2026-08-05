/**
 * 지표 카드가 화면에 어떻게 찍히는지 — `npx tsx scripts/check/cards.ts <파일>`
 *
 * 브라우저를 못 띄우는 환경에서도 표시 결과를 확인하기 위한 것이다.
 * `renderMetric`은 화면과 **같은 함수**라, 여기 나오는 문자열이 카드에 그대로 간다.
 */

import { readFileSync } from 'node:fs'

import { buildCorpus } from '@/lib/corpus'
import { CATALOG, specOf } from '@/lib/metrics/catalog'
import { evaluateAll, statusMessage } from '@/lib/metrics/registry'
import { isCsvFailure, parseCsv } from '@/lib/parsers/csv'
import { isUnsupported, parseTxt, resolveWho, toMessages, type ParseResult } from '@/lib/parsers/txt'
import { renderMetric } from '@/lib/stats/format'

const path = process.argv[2]
if (!path) {
  console.error('사용: npx tsx scripts/check/cards.ts <파일>')
  process.exit(1)
}

const body = readFileSync(path, 'utf8')
const isCsv = /\.csv$/i.test(path)

let p: ParseResult
if (isCsv) {
  const r = parseCsv(body)
  if (isCsvFailure(r)) {
    console.error(`CSV 파싱 실패 — ${r.detail}`)
    process.exit(1)
  }
  p = r
} else {
  const r = parseTxt(body)
  if (isUnsupported(r)) { console.error('형식 미지원 — iOS는 CSV로 내보내세요'); process.exit(1) }
  p = r
}

const me = process.argv.find((a) => a.startsWith('--me='))?.slice(5)
const who = resolveWho(p.title, p.speakers, me)
if (!who.resolved) {
  console.error(`본인 미확정 — --me= 로 지정하세요. 화자: ${p.speakers.map((s) => s.name).join(', ')}`)
  process.exit(1)
}

const corpus = buildCorpus(toMessages(p.raw, who.map), {
  mode: 'txt',
  source: p.source,
  deleted: p.deleted,
})
const metrics = evaluateAll(CATALOG, corpus)

console.log(`판독 창 ${corpus.windowFilled} · 정보 단위 ${corpus.infoUnits}\n`)

for (const [key, r] of Object.entries(metrics)) {
  const label = specOf(key).label
  if (r.status !== 'OK') {
    console.log(`  ${label.padEnd(15)} ${statusMessage(specOf(key), r) ?? r.status}`)
    continue
  }
  const out = renderMetric(key, r.value)
  if (out.kind === 'pair') {
    const bar = (n: number, m: number) => {
      const t = Math.abs(n) + Math.abs(m)
      const w = t === 0 ? 10 : Math.round((Math.abs(n) / t) * 20)
      return '█'.repeat(w) + '░'.repeat(20 - w)
    }
    console.log(
      `● ${label.padEnd(15)} 나 ${String(out.me).padStart(6)}${out.unit}  ${bar(out.me, out.other)}  ${String(out.other).padStart(6)}${out.unit} 상대`,
    )
    if (out.note) console.log(`  ${' '.repeat(16)}${out.note}`)
  } else {
    console.log(`● ${label.padEnd(15)} ${out.text}`)
  }
}

