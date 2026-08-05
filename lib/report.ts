/**
 * 리포트 조립 — SPEC.md §6.2, §11
 *
 * 프론트는 `status`만 보고 카드를 렌더한다. 모드 분기 없음.
 */

import { CATALOG } from './metrics/catalog'
import { evaluateAll } from './metrics/registry'
import { computeHeadline } from './stats/headline'
import { HARD_FLOOR } from './stats/sample'
import type { Corpus, HardFloor, Report } from './types'
import { computeMsgCount, computeReplyDist } from './metrics/basic'

export type ReportResult = Report | HardFloor

export function isHardFloor(r: ReportResult): r is HardFloor {
  return 'kind' in r && r.kind === 'hard_floor'
}

/**
 * 지표 3개짜리 결과에 "분석 완료"를 붙이면 도구 전체의 신뢰가 무너진다.
 * 대신 확실히 말할 수 있는 것 하나만 남긴다.
 */
export function singleFact(c: Corpus): string | null {
  const rd = computeReplyDist(c)
  if (rd.me.n >= 5 && rd.other.n >= 5) {
    const fastMe = rd.me.fast / rd.me.n
    const fastOther = rd.other.fast / rd.other.n
    if (fastMe > 0 && fastOther > 0) {
      const ratio = fastMe / fastOther
      if (ratio >= 1.5) return '답장은 상대가 더 느립니다'
      if (ratio <= 1 / 1.5) return '답장은 당신이 더 느립니다'
    }
  }

  const mc = computeMsgCount(c)
  const total = mc.me + mc.other
  if (total >= 10) {
    const share = mc.me / total
    if (share >= 0.6) return '메시지는 당신이 더 많이 보냈습니다'
    if (share <= 0.4) return '메시지는 상대가 더 많이 보냈습니다'
  }
  return null
}

export function buildReport(c: Corpus): ReportResult {
  // 하드 플로어 — 정보 단위 25 미만이면 리포트를 만들지 않는다
  if (c.infoUnits < HARD_FLOOR) {
    return { kind: 'hard_floor', infoUnits: c.infoUnits, singleFact: singleFact(c) }
  }

  return {
    mode: c.mode,
    infoUnits: c.infoUnits,
    windowFilled: c.windowFilled,
    headline: computeHeadline(c, c.semantic ?? null),
    metrics: evaluateAll(CATALOG, c),
    gaps: c.gaps,
  }
}

