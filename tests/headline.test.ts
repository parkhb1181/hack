/**
 * 헤드라인 — SPEC.md §7 · D1 종료 조건(TESTPLAN §9)
 */

import { describe, expect, it } from 'vitest'

import { buildCorpus } from '@/lib/corpus'
import {
  AXES_TOTAL,
  BAND_LABEL,
  bandOf,
  computeHeadline,
  evidenceBadge,
  norm,
} from '@/lib/stats/headline'
import { CAPTURE_SEEDS, generateCaptureSeed } from '@/lib/seed/capture'
import { captureCorpus, txtCorpus } from './helpers'
import type { Band } from '@/lib/types'

describe('norm', () => {
  it('양쪽이 0이면 0 (균형)', () => {
    expect(norm(0, 0)).toBe(0)
  })
  it('한쪽만 있으면 ±1', () => {
    expect(norm(10, 0)).toBe(1)
    expect(norm(0, 10)).toBe(-1)
  })
})

describe('밴드 경계 — SPEC §7.3', () => {
  const cases: Array<[number, Band]> = [
    [100, 'strong_me'],
    [55, 'strong_me'],
    [54, 'lean_me'],
    [20, 'lean_me'],
    [19, 'even'],
    [0, 'even'],
    [-19, 'even'],
    [-20, 'lean_other'],
    [-54, 'lean_other'],
    [-55, 'strong_other'],
    [-100, 'strong_other'],
  ]
  it.each(cases)('%i → %s', (tilt, band) => {
    expect(bandOf(tilt)).toBe(band)
  })

  it('모든 라벨이 "이 대화" 또는 "당신/상대 쪽"을 주어로 쓴다', () => {
    for (const label of Object.values(BAND_LABEL)) {
      expect(label).toMatch(/^(이 대화는|당신 쪽으로|상대 쪽으로|한쪽으로)/)
    }
  })

  it('라벨에 사람을 밀어내는 어휘가 없다 — PRD §4.5', () => {
    const BANNED = ['포기', '가망', '그만두', '손절', '아깝']
    for (const label of Object.values(BAND_LABEL)) {
      for (const w of BANNED) expect(label).not.toContain(w)
    }
  })
})

describe('결측 축을 0으로 채우지 않는다 — SPEC §7.2', () => {
  const c = txtCorpus('seed_onesided')

  it('임베딩이 없으면 3축으로 재정규화한다', () => {
    const h = computeHeadline(c, null)
    expect(h.axesUsed).toBe(3)
    expect(h.axesTotal).toBe(AXES_TOTAL)
    expect(Object.keys(h.axes)).not.toContain('sync')
  })

  it('4번째 축을 0으로 채우면 기울기가 균형 쪽으로 왜곡된다', () => {
    const h3 = computeHeadline(c, null)
    const values = Object.values(h3.axes)
    const filledWithZero = Math.round((100 * values.reduce((a, b) => a + b, 0)) / 4)
    // 0으로 채운 쪽이 실제보다 균형에 가깝다 — 이것이 재정규화의 이유다
    expect(Math.abs(filledWithZero)).toBeLessThan(Math.abs(h3.tilt))
  })

  it('임베딩이 있으면 4축이 된다', () => {
    const withEmb = buildCorpus(c.messages, {
      mode: 'txt',
      embedding: true,
      semantic: {
        syncMe: 0.62,
        syncOther: 0.41,
        styleSep: 38,
        pairs: 40,
        vectors: { me: 60, other: 55 },
      },
    })
    const h = computeHeadline(withEmb, withEmb.semantic)
    expect(h.axesUsed).toBe(4)
    expect(h.axes.sync).toBeGreaterThan(0)
  })
})

describe('D1 종료 조건 — 캡처 시드 3종이 서로 다른 밴드를 출력', () => {
  const bands = CAPTURE_SEEDS.map((n) => {
    const c = captureCorpus(n)
    return { name: n, band: computeHeadline(c, null).band, tilt: computeHeadline(c, null).tilt }
  })

  it('세 시드의 밴드가 모두 다르다', () => {
    const uniq = new Set(bands.map((b) => b.band))
    expect(uniq.size, JSON.stringify(bands)).toBe(3)
  })

  it('방향이 의도대로 나온다', () => {
    const by = Object.fromEntries(bands.map((b) => [b.name, b]))
    expect(by.cap_balanced.band).toBe('even')
    expect(by.cap_onesided_me.tilt).toBeGreaterThan(20)
    expect(by.cap_onesided_other.tilt).toBeLessThan(-20)
  })
})

describe('판독 창 — PRD §3.3', () => {
  it('txt는 최근 120개만 헤드라인에 쓴다', () => {
    const c = txtCorpus('seed_balanced')
    expect(c.messages.length).toBeGreaterThan(120)
    expect(c.windowFilled).toBe(120)
  })

  it('창이 60 미만이면 정밀도를 낮춘다', () => {
    const c = buildCorpus(generateCaptureSeed('cap_balanced').slice(0, 40), {
      mode: 'capture',
    })
    expect(computeHeadline(c, null).precisionReduced).toBe(true)
  })
})

describe('근거 배지 — SPEC §7.4', () => {
  it('txt는 기간과 세션 수를 표시한다', () => {
    const badge = evidenceBadge(txtCorpus('seed_balanced'), 60)
    expect(badge).toContain('최근 120개로 산출')
    expect(badge).toContain('개월')
    expect(badge).toContain('세션')
  })

  it('캡처는 기간을 표시하지 않는다', () => {
    const badge = evidenceBadge(captureCorpus('cap_balanced'), null)
    expect(badge).not.toContain('개월')
    expect(badge).toContain('캡처 구간')
  })
})
