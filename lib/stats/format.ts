/**
 * 지표 → 화면 표시 형태.
 *
 * 원래 화면에서 `JSON.stringify`로 임시 처리했는데 카드에
 * `{"me":59,"other":61}`이 그대로 찍혔다. 숫자는 맞지만 **읽을 수가 없다.**
 *
 * 지표마다 단위와 방향이 달라 한 가지 방식으로 못 그린다 — 어떤 건 건수,
 * 어떤 건 0~1 비율, 어떤 건 중첩 객체다. 그 변환을 여기 모은다.
 *
 * **React 밖에 둔 이유가 있다.** 화면 안에 있으면 눈으로만 확인할 수 있는데,
 * 순수 함수로 빼면 테스트가 잡는다.
 */

import type { Pair } from '@/lib/metrics/basic'

export type Rendered =
  | { kind: 'pair'; me: number; other: number; unit: string; note?: string }
  | { kind: 'text'; text: string }

export function renderMetric(key: string, v: unknown): Rendered {
  const p = v as Pair

  switch (key) {
    case 'msgCount':
      return { kind: 'pair', me: p.me, other: p.other, unit: '건' }

    case 'msgLength':
      return { kind: 'pair', me: p.me, other: p.other, unit: '자' }

    case 'questionRate':
      // 0~1로 계산되지만 화면에서는 %가 읽기 쉽다
      return {
        kind: 'pair',
        me: Math.round(p.me * 100),
        other: Math.round(p.other * 100),
        unit: '%',
        note: '질문이 담긴 차례의 비율',
      }

    case 'syncAsym':
      return {
        kind: 'pair',
        me: p.me,
        other: p.other,
        unit: '',
        note: '무작위 짝 기준선을 뺀 값 · 높을수록 상대에게 맞춘다',
      }

    case 'styleSep':
      return { kind: 'text', text: `${v as number} / 100 · 높을수록 서로 다르게 말한다` }

    case 'deletedCount':
      return { kind: 'text', text: `${v as number}건` }

    case 'initiation': {
      const i = v as { me: number; other: number; sessions: number; wakeAdjusted: boolean }
      return {
        kind: 'pair',
        me: Math.round(i.me),
        other: Math.round(i.other),
        unit: '%',
        note: `세션 ${i.sessions}개 기준${i.wakeAdjusted ? '' : ' · 기상 보정 미적용'}`,
      }
    }

    case 'noReply': {
      const n = v as Record<'me' | 'other', { rate: number }>
      return {
        kind: 'pair',
        me: Math.round(n.me.rate),
        other: Math.round(n.other.rate),
        unit: '%',
        note: '말을 걸었는데 답이 안 온 비율',
      }
    }

    case 'replyDist': {
      const d = v as Record<'me' | 'other', { fast: number; n: number }>
      const pct = (s: { fast: number; n: number }) => (s.n ? Math.round((s.fast / s.n) * 100) : 0)
      return {
        kind: 'pair',
        me: pct(d.me),
        other: pct(d.other),
        unit: '%',
        note: `5분 안에 답한 비율 · 표본 ${d.me.n + d.other.n}`,
      }
    }

    case 'emojiAffect': {
      const a = v as { me: number; other: number }
      return { kind: 'pair', me: a.me, other: a.other, unit: '', note: '−1(부정) ~ +1(긍정)' }
    }

    case 'emojiVariety': {
      const e = v as Record<'me' | 'other', { variety: number }>
      return {
        kind: 'pair',
        me: Math.round(e.me.variety * 100),
        other: Math.round(e.other.variety * 100),
        unit: '%',
        note: '같은 것만 반복하면 낮다',
      }
    }

    case 'changePoint': {
      const c = v as { month: string; drop: number } | null
      if (!c) return { kind: 'text', text: '뚜렷한 변화점 없음' }
      return { kind: 'text', text: `${Number(c.month.split('-')[1])}월부터 ${c.drop}% 줄었습니다` }
    }

    case 'monthly': {
      const m = v as { points: Array<{ month: string; count: number }>; span: number }
      const top = [...m.points].sort((a, b) => b.count - a.count)[0]
      return { kind: 'text', text: `${m.span}개월 · 가장 많았던 달 ${top?.month} (${top?.count}건)` }
    }

    case 'phraseGap': {
      const g = v as { me: Array<{ gram: string }>; other: Array<{ gram: string }> }
      const pick = (xs: Array<{ gram: string }>) =>
        xs
          .slice(0, 3)
          .map((x) => x.gram)
          .join(' · ') || '없음'
      return { kind: 'text', text: `당신 ${pick(g.me)}  /  상대 ${pick(g.other)}` }
    }

    default:
      return { kind: 'text', text: JSON.stringify(v) }
  }
}
