/**
 * 제시 수치 — LLM에 보내고, 화면에 쓰고, 검증이 허용하는 숫자의 **단일 출처**.
 *
 * `MODELS.md` §5는 "지표에 없는 숫자를 쓰면 폴백"이라 정하는데, §6 폴백 템플릿은
 * 비율과 차이를 직접 계산해 쓴다. 그대로 두면 **폴백이 자기 검증에 걸린다**
 * (실측으로 확인). 파생 값을 여기서 한 번만 만들어 세 곳이 같은 숫자를 보게 한다.
 */

import type { Pair } from '@/lib/metrics/basic'
import type { Report } from '@/lib/types'

export type Figures = {
  /** 메시지 점유율(%) — 나 기준 */
  msgSharePct?: number
  msgShareOtherPct?: number
  /** 평균 글자 수 차이 */
  lengthDiff?: number
  /** 질문 비율 차이(%p) */
  questionDiffPp?: number
  /** 먼저 말 건 비율(%) — 높은 쪽 */
  initiationTopPct?: number
  /** 이모티콘 온도차 절댓값 */
  emojiGapAbs?: number
  /** 무응답률 — 높은 쪽 */
  noReplyTopPct?: number
  /** 변화점 — 대화량이 꺾인 달(1~12)과 감소폭(%) */
  changeMonth?: number
  changeDropPct?: number
}

function ok<T>(r: Report['metrics'][string] | undefined): T | null {
  return r && r.status === 'OK' ? (r.value as T) : null
}

/** 리포트에서 실제로 인용될 파생 수치를 뽑는다 */
export function derivedFigures(report: Report): Figures {
  const m = report.metrics
  const f: Figures = {}

  const count = ok<Pair>(m.msgCount)
  if (count && count.me + count.other > 0) {
    f.msgSharePct = Math.round((count.me / (count.me + count.other)) * 100)
    f.msgShareOtherPct = 100 - f.msgSharePct
  }

  const len = ok<Pair>(m.msgLength)
  if (len) f.lengthDiff = Math.abs(Math.round(len.me - len.other))

  const q = ok<Pair>(m.questionRate)
  if (q) f.questionDiffPp = Math.abs(Math.round((q.me - q.other) * 100))

  const init = ok<{ me: number; other: number }>(m.initiation)
  if (init) f.initiationTopPct = Math.round(Math.max(init.me, init.other))

  const affect = ok<{ gap: number }>(m.emojiAffect)
  if (affect) f.emojiGapAbs = Math.abs(affect.gap)

  const nr = ok<Record<'me' | 'other', { rate: number }>>(m.noReply)
  if (nr) f.noReplyTopPct = Math.round(Math.max(nr.me.rate, nr.other.rate))

  // 변화점의 month는 "2025-03" 같은 **문자열**이라 집계 숫자로 안 잡힌다.
  // 그대로 쓰면 문장의 "2025", "03"이 §5에서 없는 숫자로 걸린다. 월만 떼어
  // 숫자로 올려두고, 문장은 "{n}월"로 쓴다.
  const cp = ok<{ month: string; drop: number } | null>(m.changePoint)
  if (cp) {
    const mm = Number(cp.month.split('-')[1])
    if (Number.isFinite(mm)) f.changeMonth = mm
    f.changeDropPct = cp.drop
  }

  return f
}

/** 검증이 대조할 대상 — 원 집계 + 파생 수치 */
export function verifiableAggregate(report: Report): { report: Report; figures: Figures } {
  return { report, figures: derivedFigures(report) }
}
