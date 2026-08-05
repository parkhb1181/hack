/**
 * 임베딩 지표 — 벡터를 손으로 만들어 공식만 검증한다(모델 호출 없음).
 */

import { describe, expect, it } from 'vitest'

import { buildCorpus } from '@/lib/corpus'
import {
  BASELINE_SHUFFLES,
  computeStyleSep,
  computeSync,
  cosine,
  embedTargets,
  l2norm,
  separationScale,
  type VecMap,
} from '@/lib/semantic/metrics'
import { SYNC_SCALE, axisSync, computeHeadline } from '@/lib/stats/headline'
import type { Msg, Who } from '@/lib/types'

const msg = (who: Who, text: string, seq: number): Msg => ({
  seq,
  who,
  ts: null,
  date: null,
  time: null,
  type: 'text',
  text,
  charCount: [...text].length,
  emojiDesc: null,
  affect: null,
  confidence: 1,
})

/** 각도로 벡터를 만든다 — 코사인이 예측 가능해진다 */
const at = (deg: number) => l2norm([Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)])

describe('전처리 — SPEC §10.1', () => {
  it('2글자 이하 반응을 뺀다', () => {
    const msgs = [
      msg('me', 'ㅇㅇ', 0),
      msg('other', 'ㅋㅋ', 1),
      msg('me', '오늘 좀 힘들었어', 2),
      msg('other', '네', 3),
      msg('me', '무슨 일 있었어?', 4),
    ]
    expect(embedTargets(msgs).map((m) => m.text)).toEqual([
      '오늘 좀 힘들었어',
      '무슨 일 있었어?',
    ])
  })

  it('미디어는 애초에 대상이 아니다', () => {
    const sticker: Msg = { ...msg('me', '', 0), type: 'nontext', text: null }
    expect(embedTargets([sticker])).toHaveLength(0)
  })
})

describe('베이스라인 감산', () => {
  /**
   * 모든 발화가 같은 방향(0~20도)에 몰려 있다.
   * 원값은 높지만 무작위 짝도 똑같이 높으므로 감산 후엔 0에 가까워야 한다.
   */
  const msgs: Msg[] = []
  const vecs: VecMap = new Map()
  for (let i = 0; i < 12; i++) {
    const who: Who = i % 2 === 0 ? 'other' : 'me'
    msgs.push(msg(who, `문장${i}`, i))
    vecs.set(i, at(i * 2))
  }

  const r = computeSync(msgs, vecs)

  it('원값은 높게 나온다 — 한 대화 안이라 다 비슷하다', () => {
    expect(r.raw.me).toBeGreaterThan(0.9)
    expect(r.raw.other).toBeGreaterThan(0.9)
  })

  it('기준선도 그만큼 높다', () => {
    expect(r.baseline.me).toBeGreaterThan(0.9)
  })

  it('감산하면 0 근처로 내려온다 — 이게 감산의 존재 이유', () => {
    expect(Math.abs(r.me)).toBeLessThan(0.1)
    expect(Math.abs(r.other)).toBeLessThan(0.1)
  })

  it('결정론적이다 — 같은 입력이면 같은 기준선', () => {
    const again = computeSync(msgs, vecs)
    expect(again).toEqual(r)
  })

  it('재배치 횟수가 고정되어 있다', () => {
    expect(BASELINE_SHUFFLES).toBe(20)
  })
})

describe('동조 축은 norm을 쓰지 않는다', () => {
  it('음수 동조율에서도 범위를 벗어나지 않는다', () => {
    // 실측에서 norm이 1.16을 뱉었던 조합
    const v = axisSync({ syncMe: 0.04, syncOther: -0.003 })
    expect(v).not.toBeNull()
    expect(v!).toBeGreaterThanOrEqual(-1)
    expect(v!).toBeLessThanOrEqual(1)
  })

  it.each([
    [0.1, -0.05, 1], // 차이 0.15 = 포화
    [-0.05, 0.1, -1],
    [0, 0, 0],
  ])('나=%s 상대=%s → %s', (me, other, want) => {
    expect(axisSync({ syncMe: me, syncOther: other })).toBeCloseTo(want, 5)
  })

  it('차이가 클수록 커지되 유계다', () => {
    const small = axisSync({ syncMe: 0.02, syncOther: 0 })!
    const big = axisSync({ syncMe: 0.5, syncOther: 0 })!
    expect(big).toBeGreaterThan(small)
    expect(big).toBe(1)
    expect(SYNC_SCALE).toBeGreaterThan(0)
  })
})

describe('말투 분리도 — SPEC §10.3', () => {
  it('두 화자가 멀리 떨어지면 높다', () => {
    const msgs: Msg[] = []
    const vecs: VecMap = new Map()
    for (let i = 0; i < 8; i++) {
      const who: Who = i % 2 === 0 ? 'me' : 'other'
      msgs.push(msg(who, `문장${i}`, i))
      vecs.set(i, at(who === 'me' ? i : 90 + i)) // 90도 벌어진 두 무리
    }
    const far = computeStyleSep(msgs, vecs)

    const near: VecMap = new Map()
    for (let i = 0; i < 8; i++) near.set(i, at(i))
    const close = computeStyleSep(msgs, near)

    expect(far.score).toBeGreaterThan(close.score)
  })

  it('0~100으로 유계다', () => {
    expect(separationScale(0)).toBe(0)
    expect(separationScale(10)).toBeLessThanOrEqual(100)
    expect(separationScale(0.5)).toBeGreaterThan(0)
  })
})

describe('4축 헤드라인', () => {
  it('임베딩이 없으면 3축, 있으면 4축', () => {
    const msgs = Array.from({ length: 40 }, (_, i) =>
      msg(i % 2 === 0 ? 'me' : 'other', `문장 ${i}`, i),
    )
    const bare = buildCorpus(msgs, { mode: 'txt' })
    expect(computeHeadline(bare, null).axesUsed).toBe(3)

    const withEmb = buildCorpus(msgs, {
      mode: 'txt',
      embedding: true,
      semantic: {
        syncMe: 0.08,
        syncOther: -0.02,
        styleSep: 40,
        pairs: 30,
        vectors: { me: 20, other: 20 },
      },
    })
    const h = computeHeadline(withEmb, withEmb.semantic)
    expect(h.axesUsed).toBe(4)
    expect(h.axes.sync).toBeGreaterThan(0)
    expect(h.axes.sync).toBeLessThanOrEqual(1)
  })
})

describe('코사인', () => {
  it('같은 방향은 1, 직교는 0', () => {
    expect(cosine(at(0), at(0))).toBeCloseTo(1, 6)
    expect(cosine(at(0), at(90))).toBeCloseTo(0, 6)
    expect(cosine(at(0), at(180))).toBeCloseTo(-1, 6)
  })
})
