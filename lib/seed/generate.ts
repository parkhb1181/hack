/**
 * 시드 데이터 생성기 — TESTPLAN.md §2
 *
 * 결정론적 PRNG를 쓴다. 같은 시드 이름 → 항상 같은 파일.
 * 골든 테스트가 생성기 난수에 흔들리면 회귀 비교의 의미가 없다.
 *
 * 시각은 전부 UTC로 고정한다. 우리는 절대 시각이 아니라 간격만 쓰므로
 * 실행 환경 타임존에 따라 골든이 흔들리는 것을 막는 편이 이득이다.
 */

import type { MsgType, Who } from '@/lib/types'

/* ------------------------------ PRNG ------------------------------ */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------ 사전 ------------------------------ */

const LONG_LINES = [
  '아까 말한 그거 생각해봤는데 아무래도 다음 주에 하는 게 나을 것 같아',
  '오늘 회의가 두 시간이나 늘어져서 점심을 세 시에 먹었어 진짜 배고팠어',
  '어제 그 카페 다시 가봤는데 자리가 없어서 그냥 편의점에서 커피 사왔어',
  '주말에 뭐 할지 정했어? 나는 그냥 집에서 쉬는 것도 괜찮을 것 같은데',
  '그 영화 봤는데 생각보다 별로였어 초반은 좋았는데 후반이 늘어지더라',
  '아침에 지하철이 멈춰서 한참 서 있었어 결국 택시 타고 갔는데 지각했어',
  '요즘 계속 잠이 안 와서 새벽에 깨는데 그러고 나면 하루가 통째로 힘들어',
]

const SHORT_LINES = [
  'ㅇㅇ',
  'ㅋㅋ',
  '넹',
  'ㅇㅋ',
  '그래',
  'ㅎㅎ',
  '응',
  '아 그래?',
  '알겠어',
  '굿',
]

const MID_LINES = [
  '오늘 좀 힘들었어',
  '밥은 먹었어?',
  '지금 뭐해',
  '나 이제 자러 갈게',
  '내일 몇 시에 볼까',
  '방금 도착했어',
  '조금만 기다려줘',
  '그건 좀 아쉽다',
  '고마워 진짜',
  '괜찮아 신경 쓰지 마',
]

const QUESTIONS = [
  '무슨 일 있었어?',
  '오늘 어땠어?',
  '지금 시간 괜찮아?',
  '밥 먹었어?',
  '주말에 뭐 해?',
  '그래서 어떻게 됐어?',
  '내일 볼 수 있어?',
]

const MULTILINE = [
  '아까 얘기한 거 정리해봤어\n1. 금요일 저녁\n2. 장소는 성수\n3. 예약은 내가 할게',
  '오늘 있었던 일 순서대로 말하면\n아침에 늦잠 자고\n점심에 회의 두 개 하고\n저녁엔 그냥 뻗었어',
  '생각해봤는데\n지금 당장 결정 안 해도 될 것 같아\n조금 더 두고 보자',
]

/* ------------------------------ 이벤트 ------------------------------ */

export type SeedEvent = {
  who: Who
  /** UTC 기준 epoch ms */
  ts: number
  type: MsgType
  text: string | null
}

export type SeedName = 'seed_balanced' | 'seed_faded' | 'seed_onesided'

export type SeedProfile = {
  /** 'me'가 세션을 여는 확률 */
  openerMe: number
  /** 화자별 버스트당 메시지 수 기댓값 */
  burstLen: Record<Who, [number, number]>
  /** 화자별 긴 문장 선택 확률 */
  longRate: Record<Who, number>
  /** 화자별 질문 확률 */
  questionRate: Record<Who, number>
  months: number
  /** 월별 활동량 배율 (길이 = months). 없으면 균일 */
  decay?: (monthIdx: number, months: number) => number
}

export const PROFILES: Record<SeedName, SeedProfile> = {
  // 양쪽이 비슷하게 주고받음 → even
  seed_balanced: {
    openerMe: 0.5,
    burstLen: { me: [1, 3], other: [1, 3] },
    longRate: { me: 0.35, other: 0.33 },
    questionRate: { me: 0.22, other: 0.2 },
    months: 8,
  },
  // 초반 활발 → 후반 급감. 양쪽 다 줄어듦 → 기울기는 even, 월별 그래프만 하락
  seed_faded: {
    openerMe: 0.5,
    burstLen: { me: [1, 3], other: [1, 3] },
    longRate: { me: 0.34, other: 0.34 },
    questionRate: { me: 0.2, other: 0.2 },
    months: 13,
    decay: (i, n) => (i < n / 2 ? 1 : 0.25),
  },
  // 한쪽이 길게 쓰고 질문하고, 상대는 단답 → lean_me / strong_me
  seed_onesided: {
    openerMe: 0.82,
    burstLen: { me: [2, 5], other: [1, 2] },
    longRate: { me: 0.72, other: 0.06 },
    questionRate: { me: 0.5, other: 0.04 },
    months: 8,
  },
}

const HOUR = 3600_000
const DAY = 24 * HOUR

function pick<T>(rnd: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rnd() * xs.length)]
}

function intBetween(rnd: () => number, [lo, hi]: [number, number]): number {
  return lo + Math.floor(rnd() * (hi - lo + 1))
}

/**
 * 시드 이벤트 생성.
 *
 * TESTPLAN §2가 요구하는 케이스를 구조적으로 보장한다:
 * 멀티라인 / 미디어 / 자정 메시지 / 아침 이어받기 / 세션 경계 / 삭제 메시지.
 */
export function generateSeed(name: SeedName): SeedEvent[] {
  const p = PROFILES[name]
  const rnd = mulberry32(hash(name))
  const events: SeedEvent[] = []

  // 2025-01-06 09:00 UTC(월요일)에서 시작
  let cursor = Date.UTC(2025, 0, 6, 9, 0)
  const startDay = cursor

  let multiline = 0
  let photos = 0
  let emoticons = 0
  let midnights = 0
  let handoffs = 0

  // 세션을 관측 기간 전체에 고르게 펼친다.
  // 여기서 뭉치면 monthly / changePoint 지표가 표본 하한에 걸려 검증이 불가능해진다.
  const SESSIONS = 60
  const step = Math.floor((p.months * 30 * DAY) / SESSIONS)

  for (let s = 0; s < SESSIONS; s++) {
    // 세션 시작 시각 결정 — 기준선에서 하루 안쪽으로 흔든다
    const base = startDay + s * step + Math.floor(rnd() * 20) * HOUR
    const isMidnight = midnights < 5 && s % 11 === 3
    const isHandoff = handoffs < 8 && s % 7 === 5

    if (isMidnight) {
      // 오전 12시대 (자정) — 시각 정규화 검증용
      cursor = dayStart(base) + 10 * 60_000 + Math.floor(rnd() * 45) * 60_000
      midnights += 1
    } else if (isHandoff) {
      // 아침 이어받기: 직전 세션 다음날 오전 7~9시
      cursor = dayStart(cursor) + DAY + 7 * HOUR + Math.floor(rnd() * 120) * 60_000
      handoffs += 1
    } else {
      cursor = dayStart(base) + 9 * HOUR + Math.floor(rnd() * 13) * HOUR
    }

    const monthIdx = Math.floor((cursor - startDay) / (30 * DAY))
    // 활동량 감소는 세션을 지우지 않고 버스트 수로 표현한다.
    // 세션이 통째로 사라지면 그 달이 월별 그래프에서 빠져 하락이 아니라 결측이 된다.
    const activity = p.decay ? p.decay(monthIdx, p.months) : 1

    let who: Who = rnd() < p.openerMe ? 'me' : 'other'
    const bursts = Math.max(2, Math.round((3 + rnd() * 6) * activity))

    for (let b = 0; b < bursts; b++) {
      const n = intBetween(rnd, p.burstLen[who])
      for (let i = 0; i < n; i++) {
        cursor += 60_000 + Math.floor(rnd() * 6) * 60_000

        // 미디어
        const r = rnd()
        if (r < 0.045 && photos < 40) {
          events.push({ who, ts: cursor, type: 'photo', text: null })
          photos += 1
          continue
        }
        if (r < 0.09 && emoticons < 40) {
          events.push({ who, ts: cursor, type: 'emoticon', text: null })
          emoticons += 1
          continue
        }

        // 멀티라인
        if (multiline < 8 && rnd() < 0.03) {
          events.push({ who, ts: cursor, type: 'text', text: pick(rnd, MULTILINE) })
          multiline += 1
          continue
        }

        const text =
          rnd() < p.questionRate[who]
            ? pick(rnd, QUESTIONS)
            : rnd() < p.longRate[who]
              ? pick(rnd, LONG_LINES)
              : rnd() < 0.55
                ? pick(rnd, SHORT_LINES)
                : pick(rnd, MID_LINES)

        events.push({ who, ts: cursor, type: 'text', text })
      }
      // 응답 지연
      cursor += 60_000 + Math.floor(rnd() * 40) * 60_000
      who = who === 'me' ? 'other' : 'me'
    }
  }

  return events.sort((a, b) => a.ts - b.ts)
}

function dayStart(ts: number): number {
  return Math.floor(ts / DAY) * DAY
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/* ------------------------------ 렌더러 ------------------------------ */

export type SeedNames = { me: string; other: string }

export const DEFAULT_NAMES: SeedNames = { me: '민서', other: '하늘' }

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

function parts(ts: number) {
  const d = new Date(ts)
  const h = d.getUTCHours()
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    dow: WEEKDAY[d.getUTCDay()],
    ampm: h < 12 ? '오전' : '오후',
    h12: h % 12 === 0 ? 12 : h % 12,
    mi: d.getUTCMinutes(),
  }
}

function bodyOf(e: SeedEvent): string {
  switch (e.type) {
    case 'text':
      return e.text ?? ''
    case 'photo':
      return '사진'
    case 'emoticon':
      return '이모티콘'
    case 'voice':
      return '음성메시지'
    case 'file':
      return '파일: 계약서.pdf'
    default:
      return ''
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** PC 카카오톡 내보내기 포맷 */
export function renderPC(
  events: SeedEvent[],
  names: SeedNames = DEFAULT_NAMES,
  deletedAt: number[] = [],
): string {
  const rec: string[] = []
  rec.push(`${names.other} 님과 카카오톡 대화`)
  rec.push('저장한 날짜 : 2026-08-04 11:00:00')
  rec.push('')

  let curDate = ''
  events.forEach((e, i) => {
    const p = parts(e.ts)
    const dateKey = `${p.y}-${p.mo}-${p.d}`
    if (dateKey !== curDate) {
      curDate = dateKey
      rec.push(
        `--------------- ${p.y}년 ${p.mo}월 ${p.d}일 ${p.dow}요일 ---------------`,
      )
    }
    const name = e.who === 'me' ? names.me : names.other
    rec.push(`[${name}] [${p.ampm} ${p.h12}:${pad(p.mi)}] ${bodyOf(e)}`)
    if (deletedAt.includes(i)) rec.push('메시지가 삭제되었습니다.')
  })

  return rec.join('\r\n')
}

/** 안드로이드 카카오톡 내보내기 포맷 (BOM 포함) */
export function renderAndroid(
  events: SeedEvent[],
  names: SeedNames = DEFAULT_NAMES,
  deletedAt: number[] = [],
): string {
  const rec: string[] = []
  rec.push(`${names.other} 님과 카카오톡 대화`)
  rec.push('저장한 날짜 : 2026년 8월 4일 오전 11:00')
  rec.push('')

  events.forEach((e, i) => {
    const p = parts(e.ts)
    const name = e.who === 'me' ? names.me : names.other
    rec.push(
      `${p.y}년 ${p.mo}월 ${p.d}일 ${p.ampm} ${p.h12}:${pad(p.mi)}, ${name} : ${bodyOf(e)}`,
    )
    if (deletedAt.includes(i)) rec.push('메시지가 삭제되었습니다.')
  })

  return '﻿' + rec.join('\r\n')
}

/** 시드별 삭제 메시지 위치 (각 2개) */
export function deletedPositions(events: SeedEvent[]): number[] {
  if (events.length < 40) return []
  return [Math.floor(events.length * 0.3), Math.floor(events.length * 0.7)]
}
