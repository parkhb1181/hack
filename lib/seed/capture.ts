/**
 * 캡처 시드 — TESTPLAN.md §2, D1 종료 조건
 *
 * D1 종료 조건은 "캡처 시드 3종이 서로 다른 밴드를 출력"이다.
 * txt 시드 3종(balanced / faded / onesided)을 그대로 쓰면 faded의 하락이
 * 월별 그래프에만 나타나므로 캡처에서는 balanced와 같은 `even`이 된다.
 * 그래서 캡처 시드는 방향이 서로 다른 3종으로 따로 정의한다.
 */

import type { Msg, Who } from '@/lib/types'
import { mulberry32 } from './generate'

export type CaptureSeedName =
  | 'cap_balanced'
  | 'cap_onesided_me'
  | 'cap_onesided_other'

type CapProfile = {
  /** 화자별 버스트 길이 범위 */
  burst: Record<Who, [number, number]>
  /** 화자별 긴 문장 확률 */
  long: Record<Who, number>
  /** 화자별 질문 확률 */
  question: Record<Who, number>
  /** 화자별 이모티콘 정서 중심 (valence) */
  valence: Record<Who, number>
  /** 총 메시지 목표 */
  total: number
}

const PROFILES: Record<CaptureSeedName, CapProfile> = {
  cap_balanced: {
    burst: { me: [1, 3], other: [1, 3] },
    long: { me: 0.35, other: 0.33 },
    question: { me: 0.2, other: 0.2 },
    valence: { me: 0.4, other: 0.35 },
    total: 58,
  },
  cap_onesided_me: {
    burst: { me: [2, 5], other: [1, 1] },
    long: { me: 0.8, other: 0.02 },
    question: { me: 0.55, other: 0.02 },
    valence: { me: 0.6, other: -0.1 },
    total: 56,
  },
  cap_onesided_other: {
    burst: { me: [1, 1], other: [2, 5] },
    long: { me: 0.02, other: 0.8 },
    question: { me: 0.02, other: 0.55 },
    valence: { me: -0.1, other: 0.6 },
    total: 56,
  },
}

/**
 * 이모티콘 비율.
 *
 * C급 지표 하한이 이모티콘 8개이고, 이모티콘 정서 카드가 데모의 근거다(PRD §10).
 * 시드가 그 하한을 넘지 못하면 D1 종료 조건을 판정할 수 없다.
 */
const EMOTICON_RATE = 0.22

/** 단답 비율. 낮추면 정보 단위가 오르고, 높이면 하드 플로어에 걸린다. */
const SHORT_RATE = 0.32

const LONG = [
  '아까 말한 그거 생각해봤는데 아무래도 다음 주에 하는 게 나을 것 같아',
  '오늘 회의가 두 시간이나 늘어져서 점심을 세 시에 먹었어 진짜 배고팠어',
  '주말에 뭐 할지 정했어 나는 그냥 집에서 쉬는 것도 괜찮을 것 같은데',
  '어제 그 카페 다시 가봤는데 자리가 없어서 그냥 편의점에서 커피 사왔어',
]
const SHORT = ['ㅇㅇ', 'ㅋㅋ', '넹', '응', 'ㅇㅋ', '그래', 'ㅎㅎ']
const MID = ['오늘 좀 힘들었어', '지금 뭐해', '방금 도착했어', '나 이제 잘게']
const QUESTION = ['무슨 일 있었어?', '오늘 어땠어?', '밥 먹었어?', '지금 시간 괜찮아?']

const EMOJI_DESC = [
  '웃으며 손 흔드는 캐릭터',
  '고개 숙이고 우는 캐릭터',
  '엄지 들어올린 캐릭터',
  '눈 감고 자는 캐릭터',
  '박수 치는 캐릭터',
]

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const pick = <T,>(rnd: () => number, xs: readonly T[]): T =>
  xs[Math.floor(rnd() * xs.length)]

/**
 * 캡처 코퍼스 생성.
 *
 * 캡처의 필드 결측을 그대로 재현한다:
 * - `ts`, `date`는 null (날짜 구분선이 안 보이는 통상 케이스)
 * - `time`은 일부만 (같은 분 연속 발화는 마지막만 표시됨)
 * - `affect`는 이모티콘에만 (Vision 2패스 산출물)
 */
export function generateCaptureSeed(name: CaptureSeedName): Msg[] {
  const p = PROFILES[name]
  const rnd = mulberry32(hash(name))
  const out: Msg[] = []

  let who: Who = 'other'
  let minute = 22 * 60 + 4 // 22:04에서 시작

  while (out.length < p.total) {
    const n = p.burst[who][0] + Math.floor(rnd() * (p.burst[who][1] - p.burst[who][0] + 1))
    for (let i = 0; i < n && out.length < p.total; i++) {
      const isEmoticon = rnd() < EMOTICON_RATE
      const isPhoto = !isEmoticon && rnd() < 0.05

      // 같은 분 연속 발화는 마지막만 시각이 표시된다 → time 결측
      const showTime = i === n - 1 || rnd() < 0.45
      if (rnd() < 0.6) minute = (minute + 1) % 1440

      const time = showTime
        ? `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
        : null

      if (isEmoticon) {
        const v = clamp(p.valence[who] + (rnd() - 0.5) * 0.6)
        out.push({
          seq: out.length,
          who,
          ts: null,
          date: null,
          time,
          type: 'emoticon',
          text: null,
          charCount: 0,
          emojiDesc: pick(rnd, EMOJI_DESC),
          affect: {
            valence: Math.round(v * 100) / 100,
            intensity: Math.round((0.5 + rnd() * 0.5) * 100) / 100,
          },
          confidence: 0.85 + rnd() * 0.14,
        })
        continue
      }

      if (isPhoto) {
        out.push({
          seq: out.length,
          who,
          ts: null,
          date: null,
          time,
          type: 'photo',
          text: null,
          charCount: 0,
          emojiDesc: '인물 사진',
          affect: { valence: 0, intensity: 0.3 },
          confidence: 0.6,
        })
        continue
      }

      const text =
        rnd() < p.question[who]
          ? pick(rnd, QUESTION)
          : rnd() < p.long[who]
            ? pick(rnd, LONG)
            : rnd() < SHORT_RATE
              ? pick(rnd, SHORT)
              : pick(rnd, MID)

      out.push({
        seq: out.length,
        who,
        ts: null,
        date: null,
        time,
        type: 'text',
        text,
        charCount: text.length,
        emojiDesc: null,
        affect: null,
        confidence: 0.9 + rnd() * 0.09,
      })
    }
    minute = (minute + 1 + Math.floor(rnd() * 8)) % 1440
    who = who === 'me' ? 'other' : 'me'
  }

  return out
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v))
}

export const CAPTURE_SEEDS: CaptureSeedName[] = [
  'cap_balanced',
  'cap_onesided_me',
  'cap_onesided_other',
]
