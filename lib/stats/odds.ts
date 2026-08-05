/**
 * 퍼센트 카드 — SPEC §7.5
 *
 * ⚠️ **이 값은 예측이 아니다. 지표의 가중 평균을 백분율로 옮긴 것이다.**
 *
 * 대화 → 실제 결과(고백했는가, 이어졌는가) 라벨 데이터셋이 없다. 그래서 어떤
 * 숫자도 "맞을 확률"이라는 뜻을 가질 수 없다. 여기서 만드는 것은 **측정된
 * 비대칭을 0~100으로 옮긴 지수**이고, 화면은 구성 요소·가중치·원값을 전부
 * 함께 보여준다. 근거를 숨긴 채 숫자만 내보내는 것이 금지된 것이지, 계산
 * 과정을 다 까고 보여주는 것까지 금지된 것은 아니다.
 *
 * 설계 규칙 둘을 그대로 지킨다.
 *   - 없는 축을 0으로 채우지 않는다. **가용한 축의 가중치만으로 다시 정규화**한다.
 *     0으로 채우면 결측이 "중립"이 되어 값을 균형 쪽으로 끌어당긴다.
 *   - LLM은 이 숫자를 만들지 않는다. `verify.ts`가 여전히 `확률`을 금지어로
 *     잡는다 — 해석 문단이 스스로 확률을 지어내는 것과 여기서 계산해 카드로
 *     보여주는 것은 다른 일이다.
 */

import type { Pair } from '@/lib/metrics/basic'
import type { Report } from '@/lib/types'

/** 화면에 반드시 함께 노출한다 — 이 문구가 빠지면 숫자가 예측처럼 읽힌다 */
export const ODDS_DISCLAIMER =
  '맞을 확률이 아닙니다. 아래 지표를 가중 평균해 100점으로 옮긴 값입니다.'

export type OddsPart = {
  key: string
  label: string
  /** 0~1로 정규화한 기여값 */
  value: number
  /** 이 축의 가중치 (재정규화 전) */
  weight: number
  /** 어디서 나온 숫자인지 — 화면에 그대로 쓴다 */
  from: string
}

export type Odds = {
  key: 'momentum' | 'reciprocity'
  label: string
  /** 0~100. 표본이 충분하면 소수 한 자리, 얇으면 5단위 */
  percent: number
  parts: OddsPart[]
  /** 가용한 축 수 / 정의된 축 수 */
  used: number
  total: number
  /** 표본이 얇아 5단위로 반올림한 상태 */
  coarse: boolean
  disclaimer: string
}

/**
 * 이 수 미만이면 카드를 내지 않는다.
 *
 * 두 카드 모두 첫 축이 기울기에서 나온다. 축이 하나뿐이면 결과는 **기울기를
 * 다른 이름으로 다시 쓴 값**이고, 그걸 별개의 신호처럼 보여주면 없는 정보를
 * 있는 것처럼 만든다. 실측: 21건짜리 표본에서 나머지 지표가 전부 표본 부족이라
 * `축 1/5`로 두 카드가 나왔는데, 둘 다 기울기의 단순 변환이었다.
 */
export const MIN_AXES = 2

function ok<T>(r: Report['metrics'][string] | undefined): T | null {
  return r && r.status === 'OK' ? (r.value as T) : null
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/**
 * 가용한 축만으로 가중 평균한다.
 *
 * 결측 축을 0.5(중립)로 채우지 않는다 — 그러면 축이 하나만 살아 있어도
 * 값이 항상 50 근처로 뭉개져 대화끼리 구별이 안 된다.
 */
/**
 * 표시 배율 — SPEC §7.3.3.
 *
 * **뭘 넣든 50 근처로 뭉친다.** 축이 전부 "0.5 근처 비율"이라 여럿을 평균하면
 * 더 세게 가운데로 끌리기 때문이다(평균으로의 회귀). 실측: 대화 6종에서
 * 기울기는 60점, `더 이어질`은 63점 벌어지는데 `상대 마음`은 **22점**뿐이었다.
 * 그 폭으로는 카드가 대화를 구별해 말하지 못한다.
 *
 * 그래서 50에서의 **편차**에 배율을 준다. `tanh`이라 아무리 키워도 0~100을
 * 벗어나지 않고, 끝으로 갈수록 완만해져 극단이 잘리지 않는다.
 *
 * ⚠️ **없는 정보를 만들지 않는다.** 단조 변환이라 대화 사이 순서는 그대로다 —
 * 벌어진 정도만 바뀐다. `SYNC_SCALE`이 동조 축에 하는 일과 같은 종류다.
 */
export const SPREAD_GAIN = 4

/**
 * 50 언저리를 비운다 — 결과는 항상 `50 ± DEAD_ZONE` 바깥에 놓인다.
 *
 * "아직 반반이에요"가 제일 자주 나오는데, 그건 사용자에게 아무 말도 안 한
 * 것과 같다. 그래서 한쪽으로 밀어 읽어준다.
 *
 * ⚠️ **대가가 있다.** 진짜로 반반인 대화도 어느 한쪽으로 밀린다. 편차가
 * 0에 가까울수록 그 방향은 근거가 얇다 — 부호를 기울기에서 가져와 최소한
 * "다른 축과 같은 방향"이 되게 맞췄지만, 그래도 아슬아슬한 판정이다.
 * 화면이 구성 축을 항상 펴 두는 이유가 여기에도 있다(SPEC §7.3.3).
 */
export const DEAD_ZONE = 12

function blend(parts: OddsPart[], coarse: boolean, tieBreak = 0): number {
  const total = parts.reduce((s, p) => s + p.weight, 0)
  if (total === 0) return 50
  const raw = parts.reduce((s, p) => s + p.value * p.weight, 0) / total
  const d = raw - 0.5

  // 편차가 사실상 0이면 방향을 기울기에서 빌린다. 그것도 0이면
  // '당신이 더 다가간 쪽'으로 둔다 — 실물에서 그쪽이 훨씬 흔하다.
  const dir = d !== 0 ? Math.sign(d) : tieBreak !== 0 ? -Math.sign(tieBreak) : -1
  const mag = DEAD_ZONE + (50 - DEAD_ZONE) * Math.tanh(Math.abs(d) * SPREAD_GAIN)
  const pct = 50 + dir * mag
  // 표본이 얇으면 5단위로 뭉갠다. 22건짜리 표본에 `73.4`를 쓰는 것은
  // 없는 정밀도를 주장하는 것이다(SPEC §6.4와 같은 취지).
  // 표본이 충분하면 소수 한 자리까지 — 정수만 쓰면 비슷한 대화가 같은 값으로 붙는다.
  return coarse ? Math.round(pct / 5) * 5 : Math.round(pct * 10) / 10
}

/* ------------------------------------------------------------------ *
 * 고백 받아줄 확률 — 상대가 이쪽으로 얼마나 기울어 있는가
 * ------------------------------------------------------------------ */

export function reciprocity(report: Report): Odds {
  const m = report.metrics
  const h = report.headline
  const parts: OddsPart[] = []

  // 기울기 자체가 가장 큰 신호다. 음수(상대 쪽)일수록 높다.
  parts.push({
    key: 'tilt',
    label: '기울기 방향',
    value: clamp01((100 - h.tilt) / 200),
    weight: 3,
    from: `기울기 ${h.tilt} → (100 − ${h.tilt}) / 200`,
  })

  const init = ok<{ me: number; other: number }>(m.initiation)
  if (init) {
    parts.push({
      key: 'initiation',
      label: '상대가 먼저 말 검',
      value: clamp01(init.other / 100),
      weight: 2,
      from: `상대 선톡 ${init.other}%`,
    })
  }

  const q = ok<Pair>(m.questionRate)
  if (q && q.me + q.other > 0) {
    parts.push({
      key: 'question',
      label: '상대가 물어봄',
      value: clamp01(q.other / (q.me + q.other)),
      weight: 2,
      from: `질문 비율 상대 ${q.other} / 당신 ${q.me}`,
    })
  }

  const nr = ok<Record<'me' | 'other', { rate: number }>>(m.noReply)
  if (nr) {
    parts.push({
      key: 'noReply',
      label: '상대가 답을 함',
      value: clamp01(1 - nr.other.rate / 100),
      weight: 2,
      from: `상대 무응답률 ${nr.other.rate}%`,
    })
  }

  const af = ok<{ me: number; other: number }>(m.emojiAffect)
  if (af) {
    parts.push({
      key: 'affect',
      label: '상대 이모티콘 온도',
      value: clamp01((af.other + 1) / 2),
      weight: 1,
      from: `상대 정서 ${af.other} (−1~+1)`,
    })
  }

  return {
    key: 'reciprocity',
    label: '상대도 마음이 있을 신호',
    percent: blend(parts, h.precisionReduced, h.tilt),
    parts,
    used: parts.length,
    total: 5,
    coarse: h.precisionReduced,
    disclaimer: ODDS_DISCLAIMER,
  }
}

/* ------------------------------------------------------------------ *
 * 더 진도 나갈 확률 — 대화가 계속 굴러갈 여지가 있는가
 * ------------------------------------------------------------------ */

export function momentum(report: Report): Odds {
  const m = report.metrics
  const h = report.headline
  const parts: OddsPart[] = []

  // 한쪽으로 쏠릴수록 오래 못 간다. 균형이 높을수록 좋다.
  parts.push({
    key: 'balance',
    label: '주고받는 균형',
    value: clamp01(1 - Math.abs(h.tilt) / 100),
    weight: 3,
    from: `기울기 절댓값 ${Math.abs(h.tilt)} → 1 − ${Math.abs(h.tilt)}/100`,
  })

  const nr = ok<Record<'me' | 'other', { rate: number }>>(m.noReply)
  if (nr) {
    const worst = Math.max(nr.me.rate, nr.other.rate)
    parts.push({
      key: 'reply',
      label: '대화가 끊기지 않음',
      value: clamp01(1 - worst / 100),
      weight: 2,
      from: `무응답률(높은 쪽) ${worst}%`,
    })
  }

  const q = ok<Pair>(m.questionRate)
  if (q) {
    // 둘 다 묻는 대화가 이어진다. 한쪽만 물으면 면접이 된다.
    const lo = Math.min(q.me, q.other)
    const hi = Math.max(q.me, q.other)
    parts.push({
      key: 'mutualQuestion',
      label: '서로 물어봄',
      value: hi > 0 ? clamp01(lo / hi) : 0,
      weight: 2,
      from: `질문 비율 ${q.me} / ${q.other} → 낮은 쪽 ÷ 높은 쪽`,
    })
  }

  const len = ok<Pair>(m.msgLength)
  if (len) {
    const lo = Math.min(len.me, len.other)
    const hi = Math.max(len.me, len.other)
    parts.push({
      key: 'lengthBalance',
      label: '분량이 비슷함',
      value: hi > 0 ? clamp01(lo / hi) : 0,
      weight: 1,
      from: `평균 길이 ${len.me} / ${len.other}자`,
    })
  }

  const cp = ok<{ month: string; drop: number } | null>(m.changePoint)
  if (cp) {
    parts.push({
      key: 'decay',
      label: '대화량이 안 줄어듦',
      value: clamp01(1 - cp.drop / 100),
      weight: 2,
      from: `${cp.month.split('-')[1]}월부터 ${cp.drop}% 감소`,
    })
  }

  return {
    key: 'momentum',
    label: '더 이어질 신호',
    percent: blend(parts, h.precisionReduced, h.tilt),
    parts,
    used: parts.length,
    total: 5,
    coarse: h.precisionReduced,
    disclaimer: ODDS_DISCLAIMER,
  }
}

export function computeOdds(report: Report): Odds[] {
  return [reciprocity(report), momentum(report)].filter((o) => o.used >= MIN_AXES)
}
