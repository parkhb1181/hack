/**
 * 표본 처리 — SPEC.md §6
 *
 * 표본 부족을 값으로 위장하지 않는다(PRD §4.3).
 */

/**
 * 하드 플로어. 정보 단위 10 미만이면 리포트를 만들지 않는다 — SPEC §6.2
 *
 * 이 값에서는 사실상 빈 입력만 거른다. 얇은 표본을 거르는 일은 §6.4 정밀도
 * 하향이 맡는다 — 리포트는 나오되 숫자를 숨기고 밴드 라벨만 보여준다.
 */
export const HARD_FLOOR = 10

/** 축소 추정 사전 표본 수 — SPEC §6.3 */
export const SHRINK_M = 8

/**
 * 비율 지표 축소 추정.
 *
 * 세션 3개 중 3개 → 원값 100% → 축소값 68%.
 * 표본이 늘면 원값에 수렴한다.
 */
export function shrinkRate(x: number, n: number, m: number = SHRINK_M): number {
  if (n <= 0) return 0.5
  return (x + m * 0.5) / (n + m)
}

/**
 * 표본이 하한의 1.5배 미만이면 정밀도를 주장하지 않는다 — SPEC §6.4
 */
export function precisionReduced(have: number, need: number): boolean {
  return have < need * 1.5
}

export type CoarseLabel = '대체로 나' | '비슷' | '대체로 상대'

/**
 * 정밀도 하향 시 소수점을 버리고 3구간 라벨로 떨어뜨린다.
 * `p`는 "나"의 비율(0~1).
 */
export function coarseLabel(p: number): CoarseLabel {
  if (p >= 0.6) return '대체로 나'
  if (p <= 0.4) return '대체로 상대'
  return '비슷'
}

/**
 * 표본이 충분하면 퍼센트, 아니면 라벨.
 * 화면 문구 생성은 여기서만 한다.
 */
export function rateDisplay(
  x: number,
  n: number,
  need: number,
): { kind: 'rate'; value: number } | { kind: 'label'; value: CoarseLabel } {
  const p = shrinkRate(x, n)
  if (precisionReduced(n, need)) return { kind: 'label', value: coarseLabel(p) }
  return { kind: 'rate', value: Math.round(p * 1000) / 10 }
}
