/**
 * 말버릇 대조 — SPEC.md §8.5
 *
 * 빈도가 아니라 **격차**로 뽑는다. 빈도로 뽑으면 양쪽 모두 `ㅋㅋ`가 1등이라
 * 대조가 되지 않는다.
 */

import { byWho } from '@/lib/corpus'
import type { Corpus } from '@/lib/types'

export const ALPHA = 0.01

/** 불용어 — 조사·어미 조각. 격차 상위를 이들이 독식하는 것을 막는다. */
export const STOPWORDS = new Set([
  '는데', '니까', '습니', '어서', '으로', '에서', '하고', '지만', '면서', '든지',
  '이나', '라고', '다고', '까지', '부터', '보다', '처럼', '만큼', '에게', '한테',
  '이랑', '그리', '그래', '그러', '이런', '저런', '그런', '아서', '어요', '아요',
  '네요', '어야', '아야', '려고', '거든', '잖아', '더라', '으면', '이면', '해서',
])

type Counts = Map<string, number>

function ngrams(text: string, min = 2, max = 4): string[] {
  const s = text.replace(/\s+/g, ' ').trim()
  const out: string[] = []
  for (let n = min; n <= max; n++) {
    for (let i = 0; i + n <= s.length; i++) {
      const g = s.slice(i, i + n)
      if (/[\s.,!?~]/.test(g)) continue
      out.push(g)
    }
  }
  return out
}

function countNgrams(texts: string[]): { counts: Counts; total: number } {
  const counts: Counts = new Map()
  let total = 0
  for (const t of texts) {
    for (const g of ngrams(t)) {
      counts.set(g, (counts.get(g) ?? 0) + 1)
      total += 1
    }
  }
  return { counts, total }
}

/**
 * 부분집합 제거 — `는데` / `그런데` 중복 해결.
 *
 * 긴 n-gram이 짧은 n-gram 출현의 80% 이상을 설명하면 짧은 쪽은 조각일 뿐이므로 버린다.
 *
 * NOTE: SPEC §8.5의 문장("짧은 n-gram 빈도가 긴 n-gram 빈도의 80% 이상이면")을
 * 문자 그대로 읽으면 항상 참이다 — 부분 문자열의 빈도는 정의상 상위 문자열의 빈도
 * 이상이기 때문이다. 의도대로 방향을 뒤집어 구현한다.
 */
export const SUBSET_RATIO = 0.8

function dropSubsets(keys: string[], freq: (k: string) => number): string[] {
  const drop = new Set<string>()
  for (const long of keys) {
    for (const short of keys) {
      if (short.length >= long.length) continue
      if (!long.includes(short)) continue
      if (freq(long) >= SUBSET_RATIO * freq(short)) drop.add(short)
    }
  }
  return keys.filter((k) => !drop.has(k))
}

export type PhraseItem = { gram: string; z: number; me: number; other: number }

export type PhraseGap = {
  me: PhraseItem[]
  other: PhraseItem[]
}

/**
 * 로그 오즈비 + 디리클레 사전.
 *
 * 결과는 클라이언트 전용이다 — LLM에 전송하지 않는다(MODELS §4.1).
 */
export function computePhraseGap(c: Corpus, topN = 8): PhraseGap {
  const texts = c.messages.filter((m) => m.type === 'text' && m.text != null)
  const g = byWho(texts, (m) => m.who)
  const A = countNgrams(g.me.map((m) => m.text as string))
  const B = countNgrams(g.other.map((m) => m.text as string))

  const all = new Set<string>([...A.counts.keys(), ...B.counts.keys()])
  let keys = [...all].filter((k) => {
    if (STOPWORDS.has(k)) return false
    const fa = A.counts.get(k) ?? 0
    const fb = B.counts.get(k) ?? 0
    return fa + fb >= 10 && fa >= 1 && fb >= 1
  })

  keys = dropSubsets(keys, (k) => (A.counts.get(k) ?? 0) + (B.counts.get(k) ?? 0))

  const V = Math.max(1, keys.length)
  const items: PhraseItem[] = keys.map((k) => {
    const fa = A.counts.get(k) ?? 0
    const fb = B.counts.get(k) ?? 0
    const za = Math.log((fa + ALPHA) / (A.total + ALPHA * V - fa - ALPHA))
    const zb = Math.log((fb + ALPHA) / (B.total + ALPHA * V - fb - ALPHA))
    return { gram: k, z: Math.round((za - zb) * 1000) / 1000, me: fa, other: fb }
  })

  return {
    me: items.filter((i) => i.z > 0).sort((a, b) => b.z - a.z).slice(0, topN),
    other: items.filter((i) => i.z < 0).sort((a, b) => a.z - b.z).slice(0, topN),
  }
}

/** 화자당 텍스트 메시지 수 중 적은 쪽 */
export function countPhraseSamples(c: Corpus): number {
  const texts = c.messages.filter((m) => m.type === 'text' && m.text != null)
  const g = byWho(texts, (m) => m.who)
  return Math.min(g.me.length, g.other.length)
}
