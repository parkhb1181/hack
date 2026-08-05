/**
 * A급 지표 계산 — 세션 없이 성립하므로 양쪽 입력에서 모두 동작한다(PRD §3.2).
 */

import { bursts, byWho, mean, round2, scoped, transitions } from '@/lib/corpus'
import type { Corpus, Msg, Who } from '@/lib/types'

export type Pair = { me: number; other: number }

export function computeMsgCount(c: Corpus): Pair {
  const g = byWho(c.window, (m) => m.who)
  return { me: g.me.length, other: g.other.length }
}

export function computeMsgLength(c: Corpus): Pair {
  const texts = c.window.filter((m) => m.type === 'text')
  const g = byWho(texts, (m) => m.who)
  return {
    me: round2(mean(g.me.map((m) => m.charCount))),
    other: round2(mean(g.other.map((m) => m.charCount))),
  }
}

/** '?' 포함 버스트 / 전체 버스트 */
export function computeQuestionRate(c: Corpus): Pair {
  const acc: Record<Who, { q: number; n: number }> = {
    me: { q: 0, n: 0 },
    other: { q: 0, n: 0 },
  }
  for (const b of bursts(c.window)) {
    acc[b.who].n += 1
    const hasQ = b.msgs.some(
      (m) => m.type === 'text' && m.text != null && m.text.includes('?'),
    )
    if (hasQ) acc[b.who].q += 1
  }
  const rate = (v: { q: number; n: number }) => (v.n === 0 ? 0 : round2(v.q / v.n))
  return { me: rate(acc.me), other: rate(acc.other) }
}

/**
 * 응답 분포 — SPEC §8.3
 *
 * 3버킷: ≤5분 / ≤1시간 / ≤6시간. 6시간 초과는 정의상 새 세션이므로 버킷이 없다.
 * 중앙값을 쓰지 않는다 — 타임스탬프가 분 단위라 활발한 대화에서 0으로 수렴한다.
 */
export type ReplyDist = Record<Who, { fast: number; mid: number; slow: number; n: number }>

export function computeReplyDist(c: Corpus): ReplyDist {
  const out: ReplyDist = {
    me: { fast: 0, mid: 0, slow: 0, n: 0 },
    other: { fast: 0, mid: 0, slow: 0, n: 0 },
  }
  for (const t of transitions(c.messages)) {
    if (t.deltaMin == null) continue
    const b = out[t.responder]
    b.n += 1
    if (t.deltaMin <= 5) b.fast += 1
    else if (t.deltaMin <= 60) b.mid += 1
    else if (t.deltaMin <= 360) b.slow += 1
  }
  return out
}

/* ---------------------------- 표본 카운터 ---------------------------- */

export function countMessages(c: Corpus, scope: 'window' | 'full' = 'window'): number {
  return scoped(c, scope).length
}

export function countBursts(c: Corpus, scope: 'window' | 'full' = 'window'): number {
  return bursts(scoped(c, scope)).length
}

/** 간격 계산이 가능한 전환 쌍만 센다 */
export function countTransitions(c: Corpus, scope: 'window' | 'full' = 'window'): number {
  return transitions(scoped(c, scope)).filter((t) => t.deltaMin != null).length
}

/** 임베딩 대상이 되는 전환 쌍(간격 불문) */
export function countPairs(c: Corpus, scope: 'window' | 'full' = 'window'): number {
  return Math.max(0, transitions(scoped(c, scope)).length)
}

/** 화자별 텍스트 메시지 수 중 적은 쪽 — "화자당 N개" 하한 판정용 */
export function countPerSpeakerTexts(
  c: Corpus,
  scope: 'window' | 'full' = 'window',
): number {
  const texts = scoped(c, scope).filter(
    (m: Msg) => m.type === 'text' && m.text != null,
  )
  const g = byWho(texts, (m) => m.who)
  return Math.min(g.me.length, g.other.length)
}
