/**
 * 폴백 한 줄 — MODELS.md §6
 *
 * 12초 타임아웃 또는 §5 검증 실패 시 쓴다. 개발자 토글로 강제할 수 있다(데모용).
 *
 * **숫자를 읽어 주지 않는다.** 예전 폴백은 가용한 축을 전부 이어 붙여
 * `메시지 점유율은 당신 57%, 상대 43%입니다. 평균 길이 차는 3자이며…`를
 * 냈다. 정확하지만 화면 위 카드가 이미 다 말한 것이고, 읽는 사람에게는
 * 아무 말도 아니다. 폴백도 LLM과 같은 자리에 붙으므로 같은 규칙을 따른다 —
 * **가장 크게 기운 축 하나만 골라 사람 말로 한 줄.**
 *
 * **없는 축을 언급하지 않는다**(§6.4). 축이 아무것도 없으면 균형 문구로 간다.
 */

import type { Report, Stage } from '@/lib/types'
import type { Pair } from '@/lib/metrics/basic'
import { derivedFigures } from './figures'
import { josa } from '@/lib/text'

/** 당신이 / 상대가 — 조사는 받침을 보고 고른다(lib/text.ts) */
export const meOther = (w: '당신' | '상대') => josa(w, '이/가')

function ok<T>(r: Report['metrics'][string] | undefined): T | null {
  return r && r.status === 'OK' ? (r.value as T) : null
}

/**
 * 어느 축이 가장 크게 기울었나.
 *
 * `strength`는 축끼리 비교하려고 0~1로 눌러 놓은 값이다 — 자릿수가 제각각인
 * 원값(3자 / 12%p / 0.4)을 그냥 비교하면 단위가 큰 축이 늘 이긴다.
 * 분모는 "이 정도면 눈에 띈다" 싶은 폭이고, 정확한 경계가 아니다.
 */
type Signal = { key: string; strength: number; mine: boolean }

/** 이보다 약하면 어느 쪽도 기울었다고 말하지 않는다 */
const FLAT = 0.18

/**
 * 축별 문구. [내 쪽, 상대 쪽] 순서, 각 두 개씩.
 *
 * **§4.2와 같은 기준이다 — 비유 없이 돌직구.** LLM이 죽었을 때 사용자가
 * 보는 게 이거라서, 여기만 말투가 다르면 폴백인 게 티가 난다.
 * 세게 말하되 사람을 깎아내리지 않는다.
 */
const LINES: Record<string, [string[], string[]]> = {
  share: [
    ['너 혼자 다 떠들었어.', '메시지 대부분 네가 보냈어.'],
    ['상대가 훨씬 많이 보냈어.', '말은 상대가 더 많이 했어.'],
  ],
  length: [
    ['너만 길게 써. 상대는 짧게 끊고.', '네 메시지가 훨씬 길어.'],
    ['상대가 훨씬 길게 써. 너는 짧게 끊고.', '긴 쪽은 상대야.'],
  ],
  question: [
    ['질문은 너만 함. 상대는 대답만 하고.', '궁금한 건 너뿐이야.'],
    ['상대가 계속 물어봐. 너는 대답만 하고.', '질문은 상대가 더 많이 해.'],
  ],
  initiation: [
    ['먼저 연락하는 거 거의 다 너야.', '대화 시작은 네가 해.'],
    ['먼저 연락하는 건 상대야.', '대화 시작은 상대가 해.'],
  ],
  emoji: [
    ['이모티콘은 너만 써. 상대는 텍스트만.', '표정 쓰는 건 너뿐이야.'],
    ['이모티콘은 상대가 더 써.', '표정 쓰는 건 상대야.'],
  ],
  // 방향이 없는 축이라 양쪽에 같은 문구를 둔다
  cool: [
    ['어느 순간부터 확 줄었어.', '중간에 한 번 끊겼어.'],
    ['어느 순간부터 확 줄었어.', '중간에 한 번 끊겼어.'],
  ],
}

const FLAT_LINES = ['둘 다 똑같이 함. 심심할 정도로 공평하네.', '차이 없어. 정확히 반반이야.']

/**
 * 폴백 한 줄.
 *
 * **파생 수치는 `derivedFigures`에서만 가져온다.** 여기서 따로 계산하면
 * 검증이 모르는 숫자가 생겨 폴백이 자기 검증에 걸린다 — 지금은 문장에
 * 숫자를 안 쓰지만, 축을 고르는 근거는 화면과 같은 값이어야 한다.
 */
export function fallbackSentence(report: Report, _stage: Stage = 'unknown'): string {
  const m = report.metrics
  const f = derivedFigures(report)
  const sigs: Signal[] = []

  if (ok<Pair>(m.msgCount) && f.msgSharePct != null) {
    sigs.push({ key: 'share', strength: Math.abs(f.msgSharePct - 50) / 25, mine: f.msgSharePct >= 50 })
  }

  const len = ok<Pair>(m.msgLength)
  if (len && f.lengthDiff != null) {
    sigs.push({ key: 'length', strength: f.lengthDiff / 12, mine: len.me >= len.other })
  }

  const q = ok<Pair>(m.questionRate)
  if (q && f.questionDiffPp != null) {
    sigs.push({ key: 'question', strength: f.questionDiffPp / 20, mine: q.me >= q.other })
  }

  const init = ok<{ me: number; other: number }>(m.initiation)
  if (init && f.initiationTopPct != null) {
    sigs.push({
      key: 'initiation',
      strength: (f.initiationTopPct - 50) / 25,
      mine: init.me >= init.other,
    })
  }

  const affect = ok<{ gap: number }>(m.emojiAffect)
  if (affect && f.emojiGapAbs != null) {
    sigs.push({ key: 'emoji', strength: f.emojiGapAbs / 0.5, mine: affect.gap >= 0 })
  }

  if (f.changeDropPct != null) {
    sigs.push({ key: 'cool', strength: f.changeDropPct / 40, mine: true })
  }

  // 같은 리포트면 같은 문구가 나와야 한다. 화면을 새로 그릴 때마다 말이
  // 바뀌면 사용자는 값이 바뀐 줄 안다.
  const pick = report.windowFilled % 2

  const top = sigs.sort((a, b) => b.strength - a.strength)[0]
  if (!top || top.strength < FLAT) return FLAT_LINES[pick]

  const pair = LINES[top.key]
  return pair[top.mine ? 0 : 1][pick]
}

/** 정보 단위가 하한에 못 미칠 때 — SPEC §6.2 */
export function hardFloorSentence(singleFact: string | null): string {
  return singleFact
    ? `이 대화에서 확실히 말할 수 있는 것 하나 — ${singleFact}`
    : '판독할 만큼의 대화가 모이지 않았습니다.'
}
