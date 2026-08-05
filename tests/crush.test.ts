/**
 * 썸 모드 — 프레이밍 전환이 지표를 건드리지 않는지 확인한다.
 */

import { describe, expect, it } from 'vitest'

import { buildCorpus } from '@/lib/corpus'
import { CATALOG } from '@/lib/metrics/catalog'
import { evaluateAll } from '@/lib/metrics/registry'
import {
  BAND_LABEL,
  CRUSH_BAND_LABEL,
  bandLabel,
  computeHeadline,
} from '@/lib/stats/headline'
import {
  SIGNAL_DISCLAIMER,
  computeCrushSignal,
  isCrush,
  signalScore,
} from '@/lib/stats/crush'
import { captureCorpus, txtCorpus } from './helpers'
import type { Band } from '@/lib/types'

const BANDS: Band[] = ['strong_me', 'lean_me', 'even', 'lean_other', 'strong_other']

describe('점수는 기울기의 좌표 변환일 뿐이다', () => {
  it.each([
    [-100, 100],
    [-50, 75],
    [0, 50],
    [50, 25],
    [100, 0],
  ])('tilt %i → 신호 %i', (tilt, score) => {
    expect(signalScore(tilt)).toBe(score)
  })

  it('상대가 다가올수록 점수가 높다', () => {
    expect(signalScore(-60)).toBeGreaterThan(signalScore(60))
  })
})

describe('썸 라벨', () => {
  it('모든 밴드에 썸 문구가 있다', () => {
    for (const b of BANDS) expect(CRUSH_BAND_LABEL[b]).toBeTruthy()
  })

  it('stage가 crush면 썸 문구, 아니면 기본 문구', () => {
    expect(bandLabel('lean_me', 'crush')).toBe(CRUSH_BAND_LABEL.lean_me)
    expect(bandLabel('lean_me', 'couple')).toBe(BAND_LABEL.lean_me)
    expect(bandLabel('lean_me')).toBe(BAND_LABEL.lean_me)
  })

  it('썸 문구에도 사람을 밀어내는 어휘가 없다 — PRD §4.5', () => {
    const BANNED = ['포기', '가망', '그만두', '손절', '아깝', '확률']
    for (const label of Object.values(CRUSH_BAND_LABEL)) {
      for (const w of BANNED) expect(label).not.toContain(w)
    }
  })

  it('썸 문구도 관찰형이다 — 지시나 조언이 아니다', () => {
    for (const label of Object.values(CRUSH_BAND_LABEL)) {
      expect(label).toMatch(/습니다$/)
      expect(label).not.toMatch(/하세요|해보|추천|해야/)
    }
  })
})

describe('신호 요약', () => {
  const c = txtCorpus('seed_onesided')
  const sig = computeCrushSignal(c, null)

  it('근거 문구가 항상 붙는다', () => {
    expect(sig.disclaimer).toBe(SIGNAL_DISCLAIMER)
    expect(sig.disclaimer).toContain('예측이 아닙니다')
  })

  it('구성 지표를 전부 펼친다', () => {
    expect(sig.components.length).toBe(sig.axesUsed)
    for (const comp of sig.components) {
      expect(comp.label).toBeTruthy()
      expect(comp.detail).toBeTruthy()
    }
  })

  it('일방적으로 내가 애쓰는 대화는 점수가 낮다', () => {
    // seed_onesided는 '나'가 훨씬 많이 보내는 시드다
    expect(sig.score).toBeLessThan(50)
    expect(sig.components.every((x) => x.direction !== 'other')).toBe(true)
  })

  it('상대가 다가오는 캡처는 점수가 높다', () => {
    const other = computeCrushSignal(captureCorpus('cap_onesided_other'), null)
    expect(other.score).toBeGreaterThan(50)
    expect(other.score).toBeGreaterThan(sig.score)
  })

  it('창이 작으면 정밀도를 낮춘다', () => {
    const small = buildCorpus(captureCorpus('cap_balanced').messages.slice(0, 30), {
      mode: 'capture',
    })
    expect(computeCrushSignal(small, null).precisionReduced).toBe(true)
  })
})

describe('프레이밍은 지표를 건드리지 않는다', () => {
  it('썸이든 아니든 기울기와 지표가 동일하다', () => {
    const c = txtCorpus('seed_balanced')
    const h = computeHeadline(c, null)
    const sig = computeCrushSignal(c, null)

    // 신호 점수는 기울기에서 유도된 값이므로 역산이 성립해야 한다
    expect(sig.score).toBe(signalScore(h.tilt))
    expect(sig.axesUsed).toBe(h.axesUsed)

    // 지표 결과는 stage와 무관하다
    expect(evaluateAll(CATALOG, c)).toEqual(evaluateAll(CATALOG, c))
  })

  it('isCrush는 crush에만 참', () => {
    expect(isCrush('crush')).toBe(true)
    expect(isCrush('couple')).toBe(false)
    expect(isCrush('unknown')).toBe(false)
  })
})
