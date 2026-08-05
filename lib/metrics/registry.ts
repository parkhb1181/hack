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
      // **어느 쪽이 필요한지 갈린다.** `affect`는 그림에서만 나오므로 캡처가,
      // 나머지(날짜·연속성)는 전체 파일이 필요하다. 한 문장으로 뭉치면
      // txt를 넣은 사람에게 "txt를 넣으세요"라고 말하게 된다(실측).
      return r.missing.includes('affect')
        ? '캡처를 올리면 열립니다'
        : '전체 대화 파일을 넣으면 열립니다'
    case 'INSUFFICIENT':
      // 조사를 박아두면 `세션가`, `개월가`가 나간다 — 받침을 보고 고른다
      return `${josa(spec.sampleUnit, '이/가')} 더 필요합니다 (${Math.floor(r.have)} / ${r.need})`
  }
}

