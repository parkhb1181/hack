/**
 * 캡처 → 리포트 전체 파이프라인 — `npx tsx scripts/dev/pipeline.ts <이름> [--real]`
 *
 * OCR 결과(.ocr.json)를 받아 공통 스키마 → 지표 → 리포트까지 돌리고,
 * 콘솔에 사람이 읽는 형태로, 파일에 응답 계약(SPEC §11) 형태로 출력한다.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildCorpus } from '@/lib/corpus'
import { CATALOG, specOf } from '@/lib/metrics/catalog'
import { evaluateAll, statusMessage } from '@/lib/metrics/registry'
import { toMessages, type OcrPage } from '@/lib/parsers/ocr'
import { buildReport, isHardFloor } from '@/lib/report'
import { HARD_FLOOR } from '@/lib/stats/sample'
import { computeCrushSignal } from '@/lib/stats/crush'
import { bandLabel, computeHeadline, evidenceBadge } from '@/lib/stats/headline'

const name = process.argv[2] ?? 'mobile_dark_sticker'
const real = process.argv.includes('--real')
const dir = join(process.cwd(), 'fixtures', real ? 'real' : 'render')

const page = JSON.parse(
  readFileSync(join(dir, `${name}.ocr.json`), 'utf8'),
) as OcrPage & { elapsed_sec?: number }

/* ── 1. OCR → 공통 스키마 ────────────────────────────────────── */
const parsed = toMessages(page)

console.log(`\n┌─ 처리 과정 ${'─'.repeat(52)}`)
console.log(`│ OCR        ${page.lines.length}줄 · ${page.elapsed_sec ?? '?'}초 · ${page.width}×${page.height}`)
console.log(`│ 화자        ${parsed.speakers}명${parsed.rejected ? ` → 거절(${parsed.rejected})` : ''}`)
console.log(`│ 말풍선      ${parsed.messages.length}개`)
if (parsed.gaps.length) console.log(`│ 결측        ${parsed.gaps.join(', ')}`)

if (parsed.rejected) {
  console.log(`└${'─'.repeat(64)}`)
  console.log('\n3인 이상 대화는 분석하지 않습니다 (PRD §5)')
  process.exit(0)
}

/* ── 2. 코퍼스 조립 ──────────────────────────────────────────── */
const corpus = buildCorpus(parsed.messages, {
  mode: 'capture',
  gaps: parsed.gaps,
})
console.log(`│ 판독 창     ${corpus.windowFilled}개 · 정보 단위 ${corpus.infoUnits}`)
console.log(`│ 가용 필드   ${[...corpus.availableFields].join(', ')}`)
console.log(`└${'─'.repeat(64)}`)

/* ── 3. 리포트 ───────────────────────────────────────────────── */
const report = buildReport(corpus)

if (isHardFloor(report)) {
  console.log(`\n■ 정보가 부족합니다 (정보 단위 ${report.infoUnits} < ${HARD_FLOOR})`)
  if (report.singleFact) console.log(`\n  확실히 말할 수 있는 것 하나`)
  if (report.singleFact) console.log(`  → ${report.singleFact}`)
} else {
  const h = computeHeadline(corpus, null)
  const sig = computeCrushSignal(corpus, null)

  console.log(`\n■ ${bandLabel(h.band, 'crush')}`)
  console.log(`  ${evidenceBadge(corpus, null)}`)
  console.log(`\n  신호 ${sig.score}${sig.precisionReduced ? ' (표본 낮음)' : ''}   ${sig.axesUsed}/${sig.axesTotal}축`)
  for (const c of sig.components) {
    console.log(`    ${c.label.padEnd(7)} ${String(c.raw).padStart(6)}   ${c.detail}`)
  }
  console.log(`\n  ${sig.disclaimer}`)

  console.log(`\n■ 지표 카드`)
  const metrics = evaluateAll(CATALOG, corpus)
  for (const [key, r] of Object.entries(metrics)) {
    const spec = specOf(key)
    const mark = r.status === 'OK' ? '●' : r.status === 'LOCKED' ? '🔒' : '◌'
    const detail =
      r.status === 'OK'
        ? JSON.stringify(r.value)
        : (statusMessage(spec, r) ?? '')
    console.log(`  ${mark} ${spec.label.padEnd(13)} ${detail.slice(0, 60)}`)
  }
}

/* ── 4. 파일 출력 ────────────────────────────────────────────── */
const out = join(dir, `${name}.report.json`)
writeFileSync(out, JSON.stringify(report, null, 2), 'utf8')
console.log(`\n파일: ${out}`)


