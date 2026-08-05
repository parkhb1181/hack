/**
 * 임베딩 지표 — SPEC.md §10
 *
 * **거리 계산은 전부 코드다.** 모델은 벡터만 반환하고, 코사인·중심·분산은
 * 결정론적 계산이다(MODELS §3.4). 이 파일에 네트워크 의존이 없어야 한다.
 */

import { bursts, mean } from '@/lib/corpus'
import { graphemeCount } from '@/lib/text'
import type { Msg, Semantic, Who } from '@/lib/types'

/**
 * 2글자 이하 반응 제외 — SPEC §10.1 / MODELS §3.2
 *
 * `ㅇㅇ`, `ㅋㅋ`, `네`, `ㅎㅎ`는 어느 관계에나 대량으로 존재해 두 사람의 벡터를
 * 같은 지점으로 끌어당긴다. 이 전처리 없으면 분리도가 항상 0에 가깝게 나온다.
 *
 * NOTE: 문서의 정규식 `^[ㄱ-ㅎㅏ-ㅣ...]{0,2}$`은 자모만 보므로 완성형 한글인
 * **`네`를 못 거른다** — 문서가 직접 든 예시가 통과해버린다. 길이로 판정한다.
 * `좋아`·`미안` 같은 의미 있는 두 글자도 함께 빠지지만, §10.1의 근거("어느
 * 관계에나 대량으로 존재")는 그쪽에도 그대로 적용된다.
 */
const TRIM_PUNCT = /[\s.,!?~]/gu

export function isEmbedSkip(text: string): boolean {
  return graphemeCount(text.replace(TRIM_PUNCT, '')) <= 2
}

export function embedTargets(msgs: Msg[]): Msg[] {
  return msgs.filter(
    (m) => m.type === 'text' && m.text != null && !isEmbedSkip(m.text),
  )
}

/* ------------------------------ 벡터 연산 ------------------------------ */

export type Vec = number[]

export function l2norm(v: Vec): Vec {
  let s = 0
  for (const x of v) s += x * x
  const n = Math.sqrt(s)
  return n === 0 ? v : v.map((x) => x / n)
}

/** 입력이 정규화되어 있으면 내적과 같다 */
export function cosine(a: Vec, b: Vec): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / Math.sqrt(na * nb)
}

export function centroid(vs: Vec[]): Vec {
  if (vs.length === 0) return []
  const out = new Array(vs[0].length).fill(0)
  for (const v of vs) for (let i = 0; i < v.length; i++) out[i] += v[i]
  return out.map((x) => x / vs.length)
}

function distance(a: Vec, b: Vec): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2
  return Math.sqrt(s)
}

/** 중심까지의 거리 제곱평균제곱근 — "그룹 내 분산"의 척도 */
function spread(vs: Vec[], c: Vec): number {
  if (vs.length === 0) return 0
  return Math.sqrt(mean(vs.map((v) => distance(v, c) ** 2)))
}

/* ------------------------------ 지표 ------------------------------ */

/** seq → 벡터. 임베딩 대상에서 제외된 메시지는 없다. */
export type VecMap = Map<number, Vec>

/** 베이스라인 추정에 쓰는 무작위 재배치 횟수 */
export const BASELINE_SHUFFLES = 20

/** 결정론적 난수 — 같은 입력이면 같은 베이스라인이 나와야 한다(TESTPLAN §7) */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 짝을 무작위로 다시 맞췄을 때의 평균 유사도.
 *
 * 두 사람은 **하나의 대화**를 하므로 아무 문장 둘을 집어도 어느 정도 비슷하다.
 * 그 바닥값을 빼야 "이 답장이 특별히 맞물렸는가"가 남는다.
 */
function baseline(pairs: Array<[Vec, Vec]>, seed: number): number {
  if (pairs.length < 2) return 0
  const rnd = seeded(seed)
  const rounds: number[] = []

  for (let k = 0; k < BASELINE_SHUFFLES; k++) {
    const idx = pairs.map((_, i) => i)
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      ;[idx[i], idx[j]] = [idx[j], idx[i]]
    }
    const sims: number[] = []
    for (let i = 0; i < pairs.length; i++) {
      if (idx[i] === i) continue // 원래 짝은 베이스라인이 아니다
      sims.push(cosine(pairs[i][0], pairs[idx[i]][1]))
    }
    if (sims.length) rounds.push(mean(sims))
  }
  return rounds.length ? mean(rounds) : 0
}

export type SyncResult = {
  me: number
  other: number
  pairs: number
  /** 감산 전 원값 — 감산이 실제로 일하는지 확인용 */
  raw: { me: number; other: number }
  /** 방향별 무작위 짝 기준선 */
  baseline: { me: number; other: number }
}

/**
 * 동조율 — SPEC §10.2
 *
 * 두 값의 차이가 "누가 상대에게 맞춰주는가"다.
 * 답장은 빠른데 동조율이 낮은 조합이 리포트에서 가장 서늘한 부분이다.
 *
 * **원값에서 무작위 짝 기준선을 뺀다.** 안 빼면 어떤 대화든 0.6~0.7 근처로
 * 몰려 모든 관계가 똑같아 보인다 — 실측으로 확인된 현상이다.
 */
export function computeSync(msgs: Msg[], vecs: VecMap): SyncResult {
  const bs = bursts(msgs)
  const paired: Record<Who, Array<[Vec, Vec]>> = { me: [], other: [] }

  for (let i = 1; i < bs.length; i++) {
    const prev = bs[i - 1].msgs[bs[i - 1].msgs.length - 1]
    const next = bs[i].msgs[0]
    const a = vecs.get(prev.seq)
    const b = vecs.get(next.seq)
    if (!a || !b) continue // 전처리에서 걸러진 반응은 전환 쌍에서 빠진다
    paired[bs[i].who].push([a, b])
  }

  const score = (who: Who, seed: number) => {
    const ps = paired[who]
    if (ps.length === 0) return { raw: 0, base: 0, net: 0 }
    const raw = mean(ps.map(([a, b]) => cosine(a, b)))
    const base = baseline(ps, seed)
    return { raw, base, net: raw - base }
  }

  const m = score('me', 0x9e37)
  const o = score('other', 0x85eb)

  return {
    me: round3(m.net),
    other: round3(o.net),
    pairs: paired.me.length + paired.other.length,
    raw: { me: round3(m.raw), other: round3(o.raw) },
    baseline: { me: round3(m.base), other: round3(o.base) },
  }
}

/**
 * 분리도를 0~100으로 매핑하는 함수.
 *
 * NOTE: SPEC §10.3은 "0~100 정규화"라고만 쓰여 있고 매핑 함수를 정하지 않았다.
 * 원값(중심 거리 / 그룹 내 퍼짐)은 상한이 없으므로 임의 절단 대신 유계 함수를 쓴다.
 * 비율 1.0 → 76, 2.0 → 96. 실데이터로 분포를 본 뒤 조정할 것.
 */
export function separationScale(ratio: number): number {
  return Math.round(100 * Math.tanh(ratio))
}

/**
 * 말투 분리도 — SPEC §10.3
 *
 * 낮으면 말투 수렴(오래 붙어 지낸 관계), 높으면 서로 다른 방식으로 말함.
 * **대칭 지표이므로 기울기 축이 아니라 상태 카드다.**
 */
export function computeStyleSep(
  msgs: Msg[],
  vecs: VecMap,
): { score: number; ratio: number; vectors: Record<Who, number> } {
  const g: Record<Who, Vec[]> = { me: [], other: [] }
  for (const m of msgs) {
    const v = vecs.get(m.seq)
    if (v) g[m.who].push(v)
  }

  const counts = { me: g.me.length, other: g.other.length }
  if (g.me.length === 0 || g.other.length === 0) {
    return { score: 0, ratio: 0, vectors: counts }
  }

  const cMe = centroid(g.me)
  const cOther = centroid(g.other)
  const between = distance(cMe, cOther)
  const within = mean([spread(g.me, cMe), spread(g.other, cOther)])

  const ratio = within === 0 ? 0 : between / within
  return { score: separationScale(ratio), ratio: round3(ratio), vectors: counts }
}

export function computeSemantic(msgs: Msg[], vecs: VecMap): Semantic {
  const sync = computeSync(msgs, vecs)
  const sep = computeStyleSep(msgs, vecs)
  return {
    syncMe: sync.me,
    syncOther: sync.other,
    styleSep: sep.score,
    pairs: sync.pairs,
    vectors: sep.vectors,
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
