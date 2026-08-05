/**
 * LLM 해석 실측 — `npx tsx scripts/check/llm.ts`
 *
 * 유닛 테스트는 네트워크를 타지 않는다. 여기서 확인하는 것은 하나다:
 * **실제 Gemini 문장이 §5 검증을 통과하는가, 아니면 매번 폴백으로 떨어지는가.**
 *
 * 폴백률이 높으면 프롬프트가 틀린 것이지 검증이 빡센 게 아니다 — 검증은
 * 못 어기는 경계이므로 손대지 않는다(MODELS §5).
 */

import { loadEnvLocal } from '@/lib/env'
loadEnvLocal()

import { buildCorpus } from '@/lib/corpus'
import { interpret, LLM_MODEL } from '@/lib/llm/interpret'
import { verifiableAggregate } from '@/lib/llm/figures'
import { verify } from '@/lib/llm/verify'
import { fallbackSentence } from '@/lib/llm/fallback'
import { isUnsupported, parseTxt, resolveWho, toMessages } from '@/lib/parsers/txt'
import { buildReport, isHardFloor } from '@/lib/report'
import type { Report, Stage } from '@/lib/types'
import type { SeedName } from '@/lib/seed/generate'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function corpusOf(name: SeedName) {
  const raw = readFileSync(join(process.cwd(), 'fixtures', 'seeds', `${name}.pc.txt`), 'utf8')
  const parsed = parseTxt(raw)
  if (isUnsupported(parsed)) throw new Error('형식 미지원')
  const who = resolveWho(parsed.title, parsed.speakers)
  if (!who.resolved) throw new Error('화자 해석 실패')
  return buildCorpus(toMessages(parsed.raw, who.map), {
    mode: 'txt',
    source: parsed.source,
    deleted: parsed.deleted,
  })
}

const CASES: Array<[SeedName, Stage]> = [
  ['seed_onesided', 'crush'],
  ['seed_balanced', 'couple'],
  ['seed_faded', 'crush'],
]

console.log(`모델: ${LLM_MODEL}\n`)

let llmCount = 0
for (const [name, stage] of CASES) {
  const report = buildReport(corpusOf(name))
  if (isHardFloor(report)) {
    console.log(`${name}: 하드 플로어 — 건너뜀\n`)
    continue
  }
  const R = report as Report

  const r = await interpret(R, stage)
  if (r.source === 'llm') llmCount++

  console.log(`━━ ${name} (${stage}) · 기울기 ${R.headline.tilt}`)
  console.log(`   ${r.source === 'llm' ? '✓ LLM' : '✗ 폴백'}  ${r.elapsedMs}ms${r.reason ? `  ← ${r.reason}` : ''}`)
  console.log(`   ${r.text}`)

  // 폴백도 숫자·어휘 검증은 통과해야 한다 — 여기서 깨지면 화면에 나갈 게 없다.
  // 문장 수는 보지 않는다: 3문장 제한(§4.2 규칙 8)은 LLM 프롬프트 규칙이고,
  // §6 템플릿은 축이 다 있으면 5문장까지 나오도록 문서에 정의돼 있다.
  const fv = verify(fallbackSentence(R, stage), verifiableAggregate(R))
  if (fv.badNumbers.length || fv.violations.length) {
    console.log(`   ⚠ 폴백 검증 실패: 숫자 ${fv.badNumbers.join(',')} / ${JSON.stringify(fv.violations)}`)
  }
  console.log()
}

console.log(`LLM 채택 ${llmCount}/${CASES.length}`)
