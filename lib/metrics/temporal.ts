/**
 * B급 지표 — 시간축 연속성이 필요하다. txt 전용, scope: full. SPEC.md §8
 */

import { sessions } from '@/lib/corpus'
import { shrinkRate } from '@/lib/stats/sample'
import type { Corpus, Msg, Session, Who } from '@/lib/types'

const DAY_MS = 24 * 60 * 60 * 1000

function minuteOfDay(m: Msg): number | null {
  if (!m.time) return null
  const r = /^(\d{1,2}):(\d{2})$/.exec(m.time)
  if (!r) return null
  return parseInt(r[1], 10) * 60 + parseInt(r[2], 10)
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[idx]
}

/* ------------------------------------------------------------------ *
 * 기상 프록시 — SPEC §8.1
 * ------------------------------------------------------------------ */

export type WakeProxy = {
  /** 화자별 기상 추정 시각(분). 표본 미달이면 null */
  minute: Record<Who, number | null>
  /** 하나라도 null이면 보정을 적용하지 않는다 */
  active: boolean
}

export const WAKE_MIN_SAMPLES = 30
export const WAKE_MIN_DAYS = 14

/**
 * 화자별 04~12시 메시지 시각의 5퍼센타일.
 *
 * 표본이 부족하면 프록시를 끄고 보정 없이 집계한다.
 * 야근·교대근무 사용자에게서 프록시가 붕괴하는 것을 막는 방어선이다.
 */
export function wakeProxy(msgs: Msg[]): WakeProxy {
  const acc: Record<Who, { mins: number[]; days: Set<string> }> = {
    me: { mins: [], days: new Set() },
    other: { mins: [], days: new Set() },
  }
  for (const m of msgs) {
    const mm = minuteOfDay(m)
    if (mm == null || m.date == null) continue
    if (mm < 4 * 60 || mm >= 12 * 60) continue
    acc[m.who].mins.push(mm)
    acc[m.who].days.add(m.date)
  }

  const minute: Record<Who, number | null> = { me: null, other: null }
  for (const who of ['me', 'other'] as Who[]) {
    const a = acc[who]
    if (a.mins.length >= WAKE_MIN_SAMPLES && a.days.size >= WAKE_MIN_DAYS) {
      minute[who] = percentile([...a.mins].sort((x, y) => x - y), 0.05)
    }
  }
  return { minute, active: minute.me != null && minute.other != null }
}

/** 세션 시작이 기상 프록시 +2h 이내이고 직전 세션이 전날이면 아침 이어받기 */
function isMorningHandoff(
  s: Session,
  prev: Session | null,
  wake: WakeProxy,
): boolean {
  if (!wake.active || prev == null) return false
  const w = wake.minute[s.opener]
  if (w == null) return false

  const first = s.msgs[0]
  const mm = minuteOfDay(first)
  if (mm == null || first.date == null) return false
  if (mm > w + 120) return false

  const prevLast = prev.msgs[prev.msgs.length - 1]
  if (prevLast.date == null) return false
  const gapDays = Math.round(
    (Date.parse(`${first.date}T00:00:00Z`) - Date.parse(`${prevLast.date}T00:00:00Z`)) /
      DAY_MS,
  )
  return gapDays === 1
}

/* ------------------------------------------------------------------ *
 * 순수 선톡률 — SPEC §8.1
 * ------------------------------------------------------------------ */

export type Initiation = {
  me: number
  other: number
  /** 아침 이어받기를 제외하고 남은 세션 수 */
  sessions: number
  /** 기상 보정을 적용했는지. false면 카드에 "기상 보정 미적용" 표시 */
  wakeAdjusted: boolean
  excludedHandoffs: number
}

export function computeInitiation(c: Corpus): Initiation {
  const ss = sessions(c.messages)
  const wake = wakeProxy(c.messages)

  let me = 0
  let n = 0
  let excluded = 0

  for (let i = 0; i < ss.length; i++) {
    if (isMorningHandoff(ss[i], i > 0 ? ss[i - 1] : null, wake)) {
      excluded += 1
      continue
    }
    n += 1
    if (ss[i].opener === 'me') me += 1
  }

  // 축소 추정 — 세션 3개 중 3개가 100%로 표시되는 것을 막는다(SPEC §6.3)
  const p = shrinkRate(me, n)
  return {
    me: Math.round(p * 1000) / 10,
    other: Math.round((1 - p) * 1000) / 10,
    sessions: n,
    wakeAdjusted: wake.active,
    excludedHandoffs: excluded,
  }
}

/* ------------------------------------------------------------------ *
 * 무응답률 — SPEC §8.2
 * ------------------------------------------------------------------ */

/**
 * 시간 임계값을 쓰지 않는다. 세션 구조만으로 정의하므로 6시간 기준과 충돌하지 않는다.
 * 6시간 후 상대가 답하면 자동으로 "상대 선톡 세션"이 되어 무응답이 아니게 된다.
 */
export type NoReply = Record<Who, { rate: number; closed: number; unanswered: number }>

export function computeNoReply(c: Corpus): NoReply {
  const ss = sessions(c.messages)
  const acc: Record<Who, { closed: number; unanswered: number }> = {
    me: { closed: 0, unanswered: 0 },
    other: { closed: 0, unanswered: 0 },
  }

  for (let i = 0; i < ss.length; i++) {
    const closer = ss[i].closer
    acc[closer].closed += 1
    const next = ss[i + 1]
    if (next == null || next.opener === closer) acc[closer].unanswered += 1
  }

  const out = {} as NoReply
  for (const who of ['me', 'other'] as Who[]) {
    const a = acc[who]
    out[who] = {
      rate: Math.round(shrinkRate(a.unanswered, a.closed) * 1000) / 10,
      closed: a.closed,
      unanswered: a.unanswered,
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 월별 온도 / 변화점 — SPEC §8.4
 * ------------------------------------------------------------------ */

export type MonthPoint = { month: string; count: number; ma: number | null }

export type Monthly = {
  points: MonthPoint[]
  /** 관측 개월 수 */
  span: number
  /** 'month' | 'week'. 3~6개월은 주별 */
  granularity: 'month' | 'week'
  /** 최대 낙폭 1지점. 12개월 미만이면 null */
  changePoint: { month: string; drop: number } | null
}

function monthKey(date: string): string {
  return date.slice(0, 7)
}

function movingAverage(values: number[], k: number): (number | null)[] {
  return values.map((_, i) => {
    if (i + 1 < k) return null
    const slice = values.slice(i + 1 - k, i + 1)
    return Math.round((slice.reduce((a, b) => a + b, 0) / k) * 10) / 10
  })
}

export function computeMonthly(c: Corpus): Monthly {
  const counts = new Map<string, number>()
  for (const m of c.messages) {
    if (m.date == null) continue
    const k = monthKey(m.date)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const months = [...counts.keys()].sort()
  const span = months.length

  const k = span >= 12 ? 3 : span >= 6 ? 2 : 1
  const values = months.map((mo) => counts.get(mo) ?? 0)
  const ma = movingAverage(values, k)
  const points: MonthPoint[] = months.map((mo, i) => ({
    month: mo,
    count: values[i],
    ma: ma[i],
  }))

  let changePoint: Monthly['changePoint'] = null
  if (span >= 12) {
    let worst = 0
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1].ma
      const b = points[i].ma
      if (a == null || b == null || a === 0) continue
      const drop = (a - b) / a
      if (drop > worst) {
        worst = drop
        changePoint = { month: points[i].month, drop: Math.round(drop * 1000) / 10 }
      }
    }
  }

  return {
    points,
    span,
    granularity: span >= 6 ? 'month' : 'week',
    changePoint,
  }
}

/** 변화점 라벨 고정 캡션 — SPEC §8.4 */
export const CHANGEPOINT_CAPTION =
  '이 시점에 무슨 일이 있었는지는 데이터가 알지 못합니다.'

/** 관측 개월 수 — monthly/changePoint 표본 카운터 */
export function countMonths(c: Corpus): number {
  const s = new Set<string>()
  for (const m of c.messages) if (m.date != null) s.add(monthKey(m.date))
  return s.size
}

export function countSessions(c: Corpus): number {
  return sessions(c.messages).length
}
