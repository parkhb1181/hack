/**
 * 상태 계약 테스트 — TESTPLAN.md §3.3
 *
 * `LOCKED`와 `INSUFFICIENT`가 서로 바뀌어 나오는 버그를 잡는 테스트다.
 */

import { describe, expect, it } from 'vitest'

import { buildCorpus } from '@/lib/corpus'
import { CATALOG, specOf } from '@/lib/metrics/catalog'
import { evaluate, evaluateAll, statusMessage } from '@/lib/metrics/registry'
import { buildReport, isHardFloor } from '@/lib/report'
import { HARD_FLOOR } from '@/lib/stats/sample'
import { generateCaptureSeed } from '@/lib/seed/capture'
import { captureCorpus, txtCorpus } from './helpers'
import type { MetricResult } from '@/lib/types'

function expectLocked(r: MetricResult, missing: string[]) {
  expect(r.status).toBe('LOCKED')
  if (r.status === 'LOCKED') expect(r.missing).toEqual(missing)
}

describe('캡처 입력', () => {
  const c = captureCorpus('cap_balanced')
  const m = evaluateAll(CATALOG, c)

  it('선톡률·무응답률은 표본 부족이 아니라 정의 불성립이므로 LOCKED', () => {
    expectLocked(m.initiation, ['ts', 'date', 'continuity'])
    expectLocked(m.noReply, ['ts', 'date', 'continuity'])
  })

  it('C급 지표는 값을 가진다 — 캡처 입력의 존재 이유', () => {
    expect(m.emojiAffect.status).toBe('OK')
    expect(m.emojiVariety.status).toBe('OK')
  })

  it('말버릇은 표본 부족이므로 INSUFFICIENT (LOCKED가 아니다)', () => {
    expect(m.phraseGap.status).toBe('INSUFFICIENT')
    if (m.phraseGap.status === 'INSUFFICIENT') {
      expect(m.phraseGap.need).toBe(200)
      expect(m.phraseGap.have).toBeLessThan(200)
    }
  })

  it('A급 지표는 세션 없이 성립한다', () => {
    expect(m.msgCount.status).toBe('OK')
    expect(m.msgLength.status).toBe('OK')
    expect(m.questionRate.status).toBe('OK')
  })
})

describe('txt 입력', () => {
  const c = txtCorpus('seed_balanced')
  const m = evaluateAll(CATALOG, c)

  it('C급 지표는 구조적으로 계산 불가이므로 LOCKED', () => {
    expectLocked(m.emojiAffect, ['affect'])
    expectLocked(m.emojiVariety, ['affect'])
  })

  it('B급 지표가 열린다 — 캡처에서 잠겨 있던 카드', () => {
    expect(m.initiation.status).toBe('OK')
    expect(m.noReply.status).toBe('OK')
    expect(m.monthly.status).toBe('OK')
    expect(m.deletedCount.status).toBe('OK')
  })

  it('임베딩 옵트아웃이면 임베딩 축만 잠긴다', () => {
    expectLocked(m.syncAsym, ['embedding'])
    expectLocked(m.styleSep, ['embedding'])
    // 나머지는 정상 (PRD §7.2 — 끄면 두 축만 빠지고 나머지 정상)
    expect(m.msgCount.status).toBe('OK')
    expect(m.replyDist.status).toBe('OK')
  })

  it('관측 8개월이면 변화점은 INSUFFICIENT', () => {
    expect(m.changePoint.status).toBe('INSUFFICIENT')
    if (m.changePoint.status === 'INSUFFICIENT') expect(m.changePoint.need).toBe(12)
  })
})

describe('seed_faded — 13개월', () => {
  const m = evaluateAll(CATALOG, txtCorpus('seed_faded'))

  it('변화점이 열리고 하락 지점을 짚는다', () => {
    expect(m.changePoint.status).toBe('OK')
    if (m.changePoint.status === 'OK') {
      const cp = m.changePoint.value as { month: string; drop: number } | null
      expect(cp).not.toBeNull()
      expect(cp!.drop).toBeGreaterThan(15)
    }
  })
})

describe('하드 플로어 — SPEC §6.2', () => {
  /**
   * 하한에 **못 미치는 가장 큰 앞부분**을 고른다.
   *
   * 슬라이스 크기를 상수로 박으면 하한이나 §6.1 가중치를 조정할 때마다
   * 테스트가 깨진다 — 실제로 40 → 25 → 10을 거치며 두 번 깨졌다.
   * 이 테스트가 보려는 것은 "몇 건이냐"가 아니라 "하한 아래에서의 동작"이다.
   */
  function belowFloor(name: Parameters<typeof generateCaptureSeed>[0]) {
    const all = generateCaptureSeed(name)
    for (let n = all.length; n >= 1; n--) {
      const c = buildCorpus(all.slice(0, n), { mode: 'capture' })
      if (c.infoUnits < HARD_FLOOR) return c
    }
    throw new Error('하한 아래인 앞부분이 없습니다')
  }

  it('정보 단위가 하한에 못 미치면 리포트를 만들지 않는다', () => {
    const c = belowFloor('cap_balanced')
    expect(c.infoUnits).toBeLessThan(HARD_FLOOR)
    expect(isHardFloor(buildReport(c))).toBe(true)
  })

  it('하드 플로어에서도 확실히 말할 수 있는 것 하나는 남긴다', () => {
    const r = buildReport(belowFloor('cap_onesided_me'))
    expect(isHardFloor(r)).toBe(true)
    if (isHardFloor(r)) {
      // 문장이 없을 수는 있지만, 있으면 관찰 문장이어야 한다(처방 금지)
      if (r.singleFact) expect(r.singleFact).toMatch(/(입니다|습니다)$/)
    }
  })
})

describe('레지스트리 계약', () => {
  it('LOCKED 판정이 표본 판정보다 먼저다', () => {
    // 필드가 없으면 표본이 아무리 많아도 LOCKED여야 한다
    const c = txtCorpus('seed_onesided')
    const r = evaluate(specOf('emojiAffect'), c)
    expect(r.status).toBe('LOCKED')
  })

  it('상태별 문구가 서로 다르다', () => {
    const spec = specOf('phraseGap')
    // 잠김은 **어느 쪽 입력이 필요한지**로 갈린다 — 그림은 캡처에서만 나온다
    expect(statusMessage(spec, { status: 'LOCKED', missing: ['affect'] })).toBe(
      '캡처를 올리면 열립니다',
    )
    expect(statusMessage(spec, { status: 'LOCKED', missing: ['date'] })).toBe(
      '전체 대화 파일을 넣으면 열립니다',
    )
    expect(
      statusMessage(spec, { status: 'INSUFFICIENT', have: 87, need: 200 }),
    ).toBe('화자당 메시지가 더 필요합니다 (87 / 200)')
    expect(statusMessage(spec, { status: 'OK', value: null })).toBeNull()
  })

  it('모든 지표 스펙이 필수 필드를 선언한다', () => {
    for (const s of CATALOG) {
      expect(s.key).toBeTruthy()
      expect(s.requires.length).toBeGreaterThan(0)
      expect(['A', 'B', 'C']).toContain(s.grade)
    }
  })
})

describe('지표 코드에 모드 분기가 없다 — PRD §4.2', () => {
  it('같은 메시지 배열이면 mode가 달라도 결과가 같다', () => {
    const msgs = generateCaptureSeed('cap_balanced')
    const asCapture = buildCorpus(msgs, { mode: 'capture' })
    const asTxt = buildCorpus(msgs, { mode: 'txt' })

    const a = evaluateAll(CATALOG, asCapture)
    const b = evaluateAll(CATALOG, asTxt)
    expect(b).toEqual(a)
  })
})
