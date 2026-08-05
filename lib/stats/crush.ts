/**
 * 썸 모드 신호 요약 — `stage === 'crush'` 화면용
 *
 * ⚠️ **이것은 예측이 아니다.** 학습 데이터도 정답 라벨도 없으므로
 * "이어질 확률"을 계산할 방법이 없다. 여기서 만드는 값은 헤드라인 축을
 * 썸 관점(상대가 다가오는 쪽이 높음)으로 뒤집어 0~100으로 옮긴 것이고,
 * 화면에는 항상 구성 지표와 함께, 예측이 아니라는 문구와 함께 표시한다.
 *
 * 새 지표를 만들지 않는다 — 기존 축을 다시 읽을 뿐이다.
 */

import type { Corpus, Headline, Stage } from '@/lib/types'
import { computeHeadline, type SemanticAxes } from './headline'

/** 화면에 반드시 함께 노출한다. 이 문구가 빠지면 점수는 예측처럼 읽힌다. */
export const SIGNAL_DISCLAIMER =
  '예측이 아닙니다. 아래 지표를 합쳐 옮긴 값입니다.'

export type Direction = 'me' | 'other' | 'even'

export type SignalComponent = {
  key: string
  label: string
  direction: Direction
  /** 원 축 값 (−1 ~ +1). 양수면 '나' 쪽 */
  raw: number
  /** 화면 문구 */
  detail: string
}

export type CrushSignal = {
  /** 0~100. 높을수록 상대 쪽 신호가 강하다. 50이 균형 */
  score: number
  /** 근거가 된 축 수 / 전체 축 수 */
  axesUsed: number
  axesTotal: number
  components: SignalComponent[]
  /** 창이 작아 숫자를 주장하지 않는 상태 */
  precisionReduced: boolean
  disclaimer: string
}

const AXIS_LABEL: Record<string, string> = {
  msgCount: '메시지 수',
  msgLength: '평균 길이',
  question: '질문',
  sync: '맞춰주는 정도',
}

/** 축 값 → 사람이 읽는 문구. 주어를 사람이 아니라 행동에 둔다. */
const AXIS_PHRASE: Record<string, [me: string, other: string]> = {
  msgCount: ['당신이 더 많이 보냅니다', '상대가 더 많이 보냅니다'],
  msgLength: ['당신 메시지가 더 깁니다', '상대 메시지가 더 깁니다'],
  question: ['당신이 더 많이 묻습니다', '상대가 더 많이 묻습니다'],
  sync: ['당신이 더 맞춰줍니다', '상대가 더 맞춰줍니다'],
}

/** 이 아래면 방향을 주장하지 않는다 */
const EVEN_BAND = 0.1
/** 이 위면 "뚜렷하게" */
const STRONG_BAND = 0.3

function directionOf(v: number): Direction {
  if (v >= EVEN_BAND) return 'me'
  if (v <= -EVEN_BAND) return 'other'
  return 'even'
}

function detailOf(key: string, v: number): string {
  const dir = directionOf(v)
  if (dir === 'even') return '비슷합니다'
  const phrase = AXIS_PHRASE[key]?.[dir === 'me' ? 0 : 1] ?? ''
  return Math.abs(v) >= STRONG_BAND ? `${phrase} (뚜렷)` : phrase
}

/**
 * 기울기를 썸 관점 점수로 옮긴다.
 *
 * tilt −100(상대 쪽) → 100 · tilt 0 → 50 · tilt +100(나) → 0
 * 새로운 계산이 아니라 좌표 변환이다. 그래서 추적 가능하다.
 */
export function signalScore(tilt: number): number {
  return Math.round(50 - tilt / 2)
}

export function computeCrushSignal(
  c: Corpus,
  semantic?: SemanticAxes | null,
): CrushSignal {
  const h: Headline = computeHeadline(c, semantic)

  const components: SignalComponent[] = Object.entries(h.axes).map(([key, raw]) => ({
    key,
    label: AXIS_LABEL[key] ?? key,
    direction: directionOf(raw),
    raw,
    detail: detailOf(key, raw),
  }))

  return {
    score: signalScore(h.tilt),
    axesUsed: h.axesUsed,
    axesTotal: h.axesTotal,
    components,
    precisionReduced: h.precisionReduced,
    disclaimer: SIGNAL_DISCLAIMER,
  }
}

/** 관계 유형이 썸일 때만 이 화면을 쓴다 */
export function isCrush(stage: Stage): boolean {
  return stage === 'crush'
}
