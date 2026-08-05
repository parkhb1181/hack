/**
 * 지표 레지스트리 — SPEC.md §5.1
 *
 * `LOCKED`와 `INSUFFICIENT`를 구분한다.
 * 앞은 "다른 입력이 필요하다", 뒤는 "더 많이 필요하다"이며 사용자에게 할 말이 다르다.
 */

import type { Corpus, MetricResult, MetricSpec } from '@/lib/types'
import { josa } from '@/lib/text'

export function evaluate(spec: MetricSpec, c: Corpus): MetricResult {
  const missing = spec.requires.filter((f) => !c.availableFields.has(f))
  if (missing.length) return { status: 'LOCKED', missing }

  const have = spec.sampleCounter(c)
  if (have < spec.minSamples) {
    return { status: 'INSUFFICIENT', have, need: spec.minSamples }
  }
  return { status: 'OK', value: spec.compute(c) }
}

export function evaluateAll(
  specs: MetricSpec[],
  c: Corpus,
): Record<string, MetricResult> {
  const out: Record<string, MetricResult> = {}
  for (const spec of specs) out[spec.key] = evaluate(spec, c)
  return out
}

/** 화면 문구. 상태별로 할 말이 다르다(PRD §6.1) */
export function statusMessage(spec: MetricSpec, r: MetricResult): string | null {
  switch (r.status) {
    case 'OK':
      return null
    case 'LOCKED':
      return '전체 대화 파일을 넣으면 열립니다'
    case 'INSUFFICIENT':
      // 조사를 박아두면 `세션가`, `개월가`가 나간다 — 받침을 보고 고른다
      return `${josa(spec.sampleUnit, '이/가')} 더 필요합니다 (${Math.floor(r.have)} / ${r.need})`
  }
}

