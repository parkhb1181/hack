/**
 * 축 상관 측정 — TESTPLAN.md §5
 *
 * SPEC §7.1의 "곱셈 분해로 이중 계상 제거" 주장을 수치로 검증한다.
 *
 * ── TESTPLAN §5에서 벗어난 부분 ─────────────────────────────────────
 * TESTPLAN은 "시드 3종 × 슬라이딩 윈도우"의 창을 **한 표본으로 합쳐** 상관을
 * 재라고 쓰여 있다. 그렇게 재면 세 축 모두 |r| ≈ 0.9가 나오는데, 이는 축이
 * 중복이라서가 아니라 시드 3종이 의도적으로 서로 다른 기울기로 설계되었기
 * 때문이다(seed_onesided는 세 축이 동시에 높고, balanced/faded는 동시에 0 근처).
 * 시드 간 분산이 시드 내 분산을 압도하므로, 합산 상관은 "축이 겹치는가"가 아니라
 * "시드가 서로 다른가"를 재게 된다.
 *
 * 그래서 여기서는 나눠서 잰다:
 * - **중복 검사(상관)** → 시드 **내부**에서. 같은 대화 안에서 두 축이 함께
 *   움직이면 그건 진짜 중복이다.
 * - **변별력 검사(표준편차)** → 시드를 **합쳐서**. 서로 다른 관계 사이에서
 *   축이 벌어지지 않으면 그건 죽은 축이다.
 *
 * NOTE: 표본은 합성 시드다. 실제 한국어 카톡의 상관은 D0에서 확보한 실파일로
 * 다시 재야 한다. 특히 `I_길이`는 죽은 축이 되기 쉽다(TESTPLAN §5 경고).
 * ────────────────────────────────────────────────────────────────
 */

import { describe, expect, it } from 'vitest'

import { buildCorpus, mean, stdev } from '@/lib/corpus'
import { axisMsgCount, axisMsgLength, axisQuestion } from '@/lib/stats/headline'
import { WINDOW_SIZE } from '@/lib/types'
import { txtCorpus } from './helpers'
import type { SeedName } from '@/lib/seed/generate'

const SEEDS: SeedName[] = ['seed_balanced', 'seed_faded', 'seed_onesided']
const STRIDE = 40
const AXES = ['msgCount', 'msgLength', 'question'] as const

/** 상관계수 임계 — 넘으면 두 축이 같은 것을 재고 있다는 뜻 */
export const R_LIMIT = 0.7
/** 변별력 하한 — 창 간 표준편차가 이보다 작으면 죽은 축이다 */
export const STDEV_FLOOR = 0.05

function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs)
  const my = mean(ys)
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i] - mx
    const b = ys[i] - my
    num += a * b
    dx += a * a
    dy += b * b
  }
  if (dx === 0 || dy === 0) return 0
  return num / Math.sqrt(dx * dy)
}

type Cols = Record<(typeof AXES)[number], number[]>

function slidingAxes(name: SeedName): Cols {
  const cols: Cols = { msgCount: [], msgLength: [], question: [] }
  const msgs = txtCorpus(name).messages
  for (let start = 0; start + WINDOW_SIZE <= msgs.length; start += STRIDE) {
    const w = buildCorpus(msgs.slice(start, start + WINDOW_SIZE), { mode: 'txt' })
    const a = axisMsgCount(w.window)
    const b = axisMsgLength(w.window)
    const q = axisQuestion(w.window)
    if (a == null || b == null || q == null) continue
    cols.msgCount.push(a)
    cols.msgLength.push(b)
    cols.question.push(q)
  }
  return cols
}

const perSeed = Object.fromEntries(SEEDS.map((s) => [s, slidingAxes(s)])) as Record<
  SeedName,
  Cols
>

const pooled: Cols = { msgCount: [], msgLength: [], question: [] }
for (const s of SEEDS) for (const k of AXES) pooled[k].push(...perSeed[s][k])

describe('창 생성', () => {
  it('창을 30개 이상 만든다 (TESTPLAN §5)', () => {
    expect(pooled.msgCount.length).toBeGreaterThanOrEqual(30)
  })
})

describe.each(SEEDS)('%s — 축 중복 검사', (seed) => {
  const cols = perSeed[seed]
  for (let i = 0; i < AXES.length; i++) {
    for (let j = i + 1; j < AXES.length; j++) {
      it(`|r(${AXES[i]}, ${AXES[j]})| ≤ ${R_LIMIT}`, () => {
        const r = pearson(cols[AXES[i]], cols[AXES[j]])
        expect(Math.abs(r), `r = ${r.toFixed(3)}`).toBeLessThanOrEqual(R_LIMIT)
      })
    }
  }
})

describe('축 변별력 검사 (시드 합산)', () => {
  it.each(AXES)('%s 축이 죽어 있지 않다 (표준편차 ≥ 0.05)', (key) => {
    const sd = stdev(pooled[key])
    expect(sd, `stdev = ${sd.toFixed(4)}`).toBeGreaterThanOrEqual(STDEV_FLOOR)
  })

  it('세 축이 서로 다른 기울기 방향을 만들 수 있다', () => {
    // 합산 상관이 높게 나오는 이유를 명시적으로 남긴다:
    // 시드 간 평균 차이가 크다 = 축이 관계를 구분한다
    const means = AXES.map((k) =>
      SEEDS.map((s) => mean(perSeed[s][k])),
    )
    for (const m of means) {
      expect(Math.max(...m) - Math.min(...m)).toBeGreaterThan(0.3)
    }
  })
})
