/**
 * C급 지표 — 정서 좌표가 필요하다. 캡처 전용. SPEC.md §9
 *
 * `affect`는 Vision 2패스 산출물이며 txt에서는 구조적으로 계산 불가다.
 * 이 지표들의 존재가 캡처 입력의 존재 이유다(PRD §3.2).
 *
 * C급은 헤드라인 축에 넣지 않는다. Vision 정서 판독이 흔들려도
 * 기울기가 흔들리지 않게 하는 방어선이다(§9.3).
 */

import { byWho, mean, round2, stdev } from '@/lib/corpus'
import type { Corpus, Msg, Who } from '@/lib/types'

/** affect가 붙은 이모티콘만 대상 */
function affectiveEmoticons(c: Corpus): Msg[] {
  return c.messages.filter((m) => m.type === 'emoticon' && m.affect != null)
}

export function countEmoticons(c: Corpus): number {
  return affectiveEmoticons(c).length
}

/** score(m) = valence × intensity */
function score(m: Msg): number {
  return (m.affect as NonNullable<Msg['affect']>).valence * (m.affect as NonNullable<Msg['affect']>).intensity
}

export type EmojiAffect = {
  me: number
  other: number
  /** 온도차를 표시용 −100 ~ +100으로 정규화한 값 */
  gap: number
}

/**
 * 이모티콘 온도차.
 *
 * 원 범위 −2.0 ~ +2.0 → 표시용 −100 ~ +100.
 */
export function computeEmojiAffect(c: Corpus): EmojiAffect {
  const g = byWho(affectiveEmoticons(c), (m) => m.who)
  const me = mean(g.me.map(score))
  const other = mean(g.other.map(score))
  return {
    me: round2(me),
    other: round2(other),
    gap: Math.round(((me - other) / 2) * 100),
  }
}

export type EmojiVariety = Record<Who, { variety: number; unique: number; total: number }>

/**
 * 이모티콘 정서 다양도.
 *
 * 한 종류만 반복하는 쪽은 형식적으로 쓰는 것이다.
 */
export function computeEmojiVariety(c: Corpus): EmojiVariety {
  const g = byWho(affectiveEmoticons(c), (m) => m.who)
  const out = {} as EmojiVariety
  for (const who of ['me', 'other'] as Who[]) {
    const ms = g[who]
    const uniq = new Set(ms.map((m) => m.emojiDesc ?? '')).size
    const sd = stdev(ms.map((m) => (m.affect as NonNullable<Msg['affect']>).valence))
    out[who] = {
      variety: ms.length === 0 ? 0 : round2(sd * (uniq / ms.length)),
      unique: uniq,
      total: ms.length,
    }
  }
  return out
}
