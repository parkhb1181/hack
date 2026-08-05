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
    expect(renderMetric('changePoint', null)).toEqual({
      kind: 'text',
      text: '뚜렷한 변화점 없음',
    })
    expect(renderMetric('changePoint', { month: '2026-03', drop: 41.2 })).toEqual({
      kind: 'text',
      text: '3월부터 41.2% 줄었습니다',
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
