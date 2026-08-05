/**
 * 폴백 템플릿 — MODELS.md §6
 *
 * 12초 타임아웃 또는 §5 검증 실패 시 쓴다. 개발자 토글로 강제할 수 있다(데모용).
 *
 * **없는 축을 언급하지 않는다.** 폴백도 같은 규칙을 따른다(§6.4).
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
 * 헤드라인 축만 인용한다 — 두 모드가 같은 문장을 쓴다(§6.1).
 * 가용하지 않은 축은 문장에서 빠진다(§6.4).
 *
 * **파생 수치는 `derivedFigures`에서만 가져온다.** 여기서 따로 계산하면
 * 검증이 모르는 숫자가 생겨 폴백이 자기 검증에 걸린다.
 */
export function fallbackSentence(report: Report, _stage: Stage = 'unknown'): string {
  const m = report.metrics
  const f = derivedFigures(report)
  // 표본이 얇으면 화면이 기울기 숫자를 숨긴다(SPEC §7.3). 폴백도 같은 규칙을
  // 따른다 — 화면이 숨긴 값을 문단이 대신 말하면 숨긴 의미가 없다.
  const parts: string[] = report.headline.precisionReduced
    ? []
    : [`기울기 ${report.headline.tilt}.`]

  const count = ok<Pair>(m.msgCount)
  if (count && f.msgSharePct != null && f.msgShareOtherPct != null) {
    const mine = f.msgSharePct >= 50
    parts.push(
      `메시지는 ${meOther(mine ? '당신' : '상대')} ${mine ? f.msgSharePct : f.msgShareOtherPct}% 보냈고,`,
    )
  }

  const len = ok<Pair>(m.msgLength)
  if (len && f.lengthDiff != null) {
    parts.push(`평균 길이는 ${len.me >= len.other ? '당신' : '상대'} 쪽이 ${f.lengthDiff}자 더 깁니다.`)
  }

  const q = ok<Pair>(m.questionRate)
  if (q && f.questionDiffPp != null) {
    parts.push(
      `질문이 담긴 차례는 ${q.me >= q.other ? '당신' : '상대'} 쪽이 ${f.questionDiffPp}%p 많습니다.`,
    )
  }

  // §6.3 캡처 추가 문장 — C급 지표가 가용할 때만
  const affect = ok<{ gap: number }>(m.emojiAffect)
  if (affect && f.emojiGapAbs != null) {
    parts.push(
      `이모티콘의 정서는 ${affect.gap >= 0 ? '당신' : '상대'} 쪽이 ${f.emojiGapAbs}만큼 더 밝습니다.`,
    )
  }

  // §6.2 txt 추가 문장 — B급 지표가 가용할 때만
  const init = ok<{ me: number; other: number }>(m.initiation)
  const decay =
    f.changeMonth != null && f.changeDropPct != null
      ? `${f.changeMonth}월부터 대화량이 ${f.changeDropPct}% 줄었고, `
      : ''
  if (init && f.initiationTopPct != null) {
    parts.push(
      `${decay}먼저 말을 건 쪽은 ${meOther(init.me >= init.other ? '당신' : '상대')} ${f.initiationTopPct}%입니다.`,
    )
  } else if (decay) {
    parts.push(`${f.changeMonth}월부터 대화량이 ${f.changeDropPct}% 줄었습니다.`)
  }

  return parts.join(' ')
}

/** 정보 단위가 하한에 못 미칠 때 — SPEC §6.2 */
export function hardFloorSentence(singleFact: string | null): string {
  return singleFact
    ? `이 대화에서 확실히 말할 수 있는 것 하나 — ${singleFact}`
    : '판독할 만큼의 대화가 모이지 않았습니다.'
}


