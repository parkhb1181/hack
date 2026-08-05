/**
 * 지표 표시 형태 — 화면에 원시 JSON이 나가면 안 된다.
 *
 * 실측: 카드에 `{"me":59,"other":61}`이 그대로 찍혔다. 숫자는 맞았지만
 * 읽을 수가 없었다. 여기서 잡는 것은 "카드마다 사람이 읽는 형태가 나오는가"다.
 */

import { describe, expect, it } from 'vitest'

import { CATALOG } from '@/lib/metrics/catalog'
import { evaluateAll, statusMessage } from '@/lib/metrics/registry'
import { renderMetric } from '@/lib/stats/format'
import { computeOdds, DEAD_ZONE, SPREAD_GAIN } from '@/lib/stats/odds'
import { buildReport, isHardFloor } from '@/lib/report'
import { txtCorpus } from './helpers'

describe('표시 변환', () => {
  it('건수는 그대로, 비율은 %로 바꾼다', () => {
    expect(renderMetric('msgCount', { me: 59, other: 61 })).toEqual({
      kind: 'pair',
      me: 59,
      other: 61,
      unit: '건',
    })
    const q = renderMetric('questionRate', { me: 0.2, other: 0.25 })
    expect(q).toMatchObject({ kind: 'pair', me: 20, other: 25, unit: '%' })
  })

  /**
   * 말버릇을 한 줄 평문으로 이어 붙이면 `당신 ㅋㅋ · 근데 / 상대 ㅇㅇ`이 되어
   * 어디까지가 누구 것인지 안 보였다. 낱말 목록으로 넘겨야 화면이 알약으로
   * 끊어 그릴 수 있다.
   */
  it('말버릇은 낱말 목록으로 넘긴다', () => {
    const r = renderMetric('phraseGap', {
      me: [{ gram: 'ㅋㅋ' }, { gram: '근데' }, { gram: '아니' }, { gram: '그래서' }],
      other: [{ gram: 'ㅇㅇ' }],
    })
    expect(r).toMatchObject({ kind: 'chips', me: ['ㅋㅋ', '근데', '아니'], other: ['ㅇㅇ'] })
  })

  it('말버릇이 비어도 알약 형태를 유지한다', () => {
    // 예전에는 여기서 '없음'이 섞인 문자열이 나왔다 — 화면이 갈래를 못 나눈다
    expect(renderMetric('phraseGap', { me: [], other: [] })).toMatchObject({
      kind: 'chips',
      me: [],
      other: [],
    })
  })

  it('중첩 객체를 한 쌍으로 눌러 편다', () => {
    // 응답 분포는 {me:{fast,mid,slow,n}, other:{...}} — 그대로 찍으면 못 읽는다
    const r = renderMetric('replyDist', {
      me: { fast: 55, mid: 11, slow: 0, n: 70 },
      other: { fast: 51, mid: 13, slow: 0, n: 69 },
    })
    expect(r).toMatchObject({ kind: 'pair', me: 79, other: 74, unit: '%' })
    expect((r as { note: string }).note).toContain('139')
  })

  it('무응답률은 rate만 꺼낸다', () => {
    const r = renderMetric('noReply', {
      me: { rate: 82.1, closed: 3, unanswered: 5 },
      other: { rate: 29.7, closed: 2, unanswered: 1 },
    })
    expect(r).toMatchObject({ kind: 'pair', me: 82, other: 30 })
  })

  it('변화점이 없으면 없다고 쓴다 — null을 찍지 않는다', () => {
    expect(renderMetric('changePoint', null)).toMatchObject({ kind: 'text' })
    // 있으면 숫자로 세운다. 평문으로 두면 다른 카드와 따로 논다
    expect(renderMetric('changePoint', { month: '2026-03', drop: 41.2 })).toMatchObject({
      kind: 'single',
      value: 41.2,
      unit: '%',
      max: 100,
    })
  })

  it('선톡률은 세션 수를 근거로 붙인다', () => {
    const r = renderMetric('initiation', {
      me: 77.3,
      other: 22.7,
      sessions: 41,
      wakeAdjusted: false,
    })
    expect(r).toMatchObject({ kind: 'pair', me: 77, other: 23, unit: '%' })
    expect((r as { note: string }).note).toContain('41')
    expect((r as { note: string }).note).toContain('기상 보정 미적용')
  })
})

describe('실제 지표 전부 — JSON이 새어나가면 안 된다', () => {
  const corpus = txtCorpus('seed_onesided')
  const metrics = evaluateAll(CATALOG, corpus)

  it('OK인 지표는 하나도 원시 JSON으로 안 나온다', () => {
    const leaked: string[] = []
    for (const [key, r] of Object.entries(metrics)) {
      if (r.status !== 'OK') continue
      const out = renderMetric(key, r.value)
      // 기본 분기(JSON.stringify)로 떨어진 것만 잡는다
      if (out.kind === 'text' && /^[[{]/.test(out.text)) leaked.push(key)
    }
    expect(leaked).toEqual([])
  })

  it('숫자 쌍은 유한값이다', () => {
    for (const [key, r] of Object.entries(metrics)) {
      if (r.status !== 'OK') continue
      const out = renderMetric(key, r.value)
      if (out.kind !== 'pair') continue
      expect(Number.isFinite(out.me), `${key}.me`).toBe(true)
      expect(Number.isFinite(out.other), `${key}.other`).toBe(true)
    }
  })
})

/**
 * 잠긴 지표는 **어느 쪽 입력이 필요한지**를 말해야 한다.
 * 한 문장으로 뭉치면 txt를 넣은 사람에게 "txt를 넣으세요"라고 말한다(실측).
 */
describe('잠김 안내 — SPEC §5.1', () => {
  const spec = CATALOG.find((s) => s.key === 'emojiAffect')!
  const other = CATALOG.find((s) => s.key === 'monthly')!

  it('그림이 필요하면 캡처를 안내한다', () => {
    const msg = statusMessage(spec, { status: 'LOCKED', missing: ['affect'] })
    expect(msg).toContain('캡처')
    expect(msg).not.toContain('전체 대화 파일')
  })

  it('시간축이 필요하면 전체 파일을 안내한다', () => {
    const msg = statusMessage(other, { status: 'LOCKED', missing: ['date', 'continuity'] })
    expect(msg).toContain('전체 대화 파일')
    expect(msg).not.toContain('캡처')
  })
})

/**
 * 퍼센트가 50 근처로 뭉치면 카드가 대화를 구별해 말하지 못한다.
 * 실측: 대화 6종에서 `상대 마음`이 22점밖에 안 벌어졌다(기울기는 60점).
 */
describe('퍼센트 퍼짐 — SPEC §7.3.3', () => {
  const at = (raw: number) => 50 + 50 * Math.tanh((raw - 0.5) * SPREAD_GAIN)

  it('0~100을 벗어나지 않는다', () => {
    for (const raw of [0, 0.1, 0.5, 0.9, 1]) {
      const v = at(raw)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('가운데는 그대로 50이다', () => {
    expect(at(0.5)).toBeCloseTo(50, 6)
  })

  it('단조다 — 순서가 바뀌면 안 된다', () => {
    const xs = [0.2, 0.35, 0.45, 0.5, 0.55, 0.7, 0.85]
    const ys = xs.map(at)
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1])
  })

  it('차이를 벌린다 — 이게 존재 이유', () => {
    // 배율 없이는 0.42~0.57이 42~57(15점). 배율을 넣으면 더 벌어져야 한다
    expect(at(0.57) - at(0.42)).toBeGreaterThan(15)
  })

  it('극단에서 잘리지 않고 완만해진다', () => {
    // 0.9와 1.0의 간격이 0.5와 0.6의 간격보다 좁다 (포화)
    expect(at(1.0) - at(0.9)).toBeLessThan(at(0.6) - at(0.5))
  })
})

/**
 * "50% 근처는 아무 말도 안 한 것과 같다"는 판단으로 가운데를 비웠다.
 * 값이 그 안에 들어오면 카드가 다시 밋밋해진다.
 */
describe('가운데 구간을 비운다 — SPEC §7.3.3', () => {
  const corpus = txtCorpus('seed_balanced')
  const report = buildReport(corpus)

  it('균형 대화도 50 근처에 놓이지 않는다', () => {
    if (isHardFloor(report)) return
    for (const o of computeOdds(report)) {
      expect(Math.abs(o.percent - 50)).toBeGreaterThanOrEqual(DEAD_ZONE - 0.05)
    }
  })

  it('일방적 대화는 더 멀리 간다 — 순서가 유지된다', () => {
    const one = buildReport(txtCorpus('seed_onesided'))
    if (isHardFloor(one) || isHardFloor(report)) return
    const r = (rep: typeof one) =>
      computeOdds(rep as never).find((o) => o.key === 'reciprocity')!.percent
    // 일방적(내가 더 다가감)이 균형보다 낮아야 한다
    expect(r(one)).toBeLessThan(r(report as never))
  })
})
