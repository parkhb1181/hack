/**
 * 지표 카탈로그 — SPEC.md §5.2
 *
 * 지표는 입력 모드가 아니라 필요 필드에 매달린다(PRD §4.2).
 * 이 파일 어디에도 `mode === 'capture'` 분기가 없어야 한다.
 */

import type { Corpus, MetricSpec } from '@/lib/types'
import {
  computeMsgCount,
  computeMsgLength,
  computeQuestionRate,
  computeReplyDist,
  countBursts,
  countMessages,
  countPerSpeakerTexts,
  countTransitions,
} from './basic'
import { computeEmojiAffect, computeEmojiVariety, countEmoticons } from './affect'
import { computePhraseGap, countPhraseSamples } from './phrase'
import {
  computeInitiation,
  computeMonthly,
  computeNoReply,
  countMonths,
  countSessions,
} from './temporal'

const semanticOf = (c: Corpus) => c.semantic

export const CATALOG: MetricSpec[] = [
  {
    key: 'msgCount',
    label: '메시지수 비대칭',
    grade: 'A',
    requires: ['who'],
    minSamples: 30,
    sampleUnit: '메시지',
    sampleCounter: (c) => countMessages(c, 'window'),
    scope: 'window',
    compute: computeMsgCount,
  },
  {
    key: 'msgLength',
    label: '평균 길이 비대칭',
    grade: 'A',
    requires: ['who', 'text'],
    minSamples: 30,
    sampleUnit: '메시지',
    sampleCounter: (c) => countMessages(c, 'window'),
    scope: 'window',
    compute: computeMsgLength,
  },
  {
    key: 'questionRate',
    label: '질문 버스트 비율',
    grade: 'A',
    requires: ['who', 'text'],
    minSamples: 20,
    sampleUnit: '버스트',
    sampleCounter: (c) => countBursts(c, 'window'),
    scope: 'window',
    compute: computeQuestionRate,
  },
  {
    key: 'syncAsym',
    label: '동조율 방향 비대칭',
    grade: 'A',
    requires: ['text', 'embedding'],
    minSamples: 20,
    sampleUnit: '전환 쌍',
    sampleCounter: (c) => semanticOf(c)?.pairs ?? 0,
    scope: 'window',
    compute: (c) => {
      const s = semanticOf(c)
      return s ? { me: s.syncMe, other: s.syncOther } : null
    },
  },
  {
    key: 'styleSep',
    label: '말투 분리도',
    grade: 'A',
    requires: ['text', 'embedding'],
    minSamples: 30,
    sampleUnit: '화자당 메시지',
    sampleCounter: (c) => {
      const s = semanticOf(c)
      return s ? Math.min(s.vectors.me, s.vectors.other) : 0
    },
    scope: 'window',
    // 대칭 지표이므로 기울기 축이 아니라 상태 카드다(SPEC §10.3)
    compute: (c) => semanticOf(c)?.styleSep ?? null,
  },
  {
    key: 'replyDist',
    label: '응답 분포',
    grade: 'A',
    requires: ['time', 'who'],
    minSamples: 20,
    sampleUnit: '전환 쌍',
    sampleCounter: (c) => countTransitions(c, 'full'),
    scope: 'full',
    compute: computeReplyDist,
  },
  {
    key: 'initiation',
    label: '순수 선톡률',
    grade: 'B',
    requires: ['ts', 'date', 'continuity'],
    minSamples: 20,
    sampleUnit: '세션',
    sampleCounter: countSessions,
    scope: 'full',
    compute: computeInitiation,
  },
  {
    key: 'noReply',
    label: '무응답률',
    grade: 'B',
    requires: ['ts', 'date', 'continuity'],
    minSamples: 20,
    sampleUnit: '세션',
    sampleCounter: countSessions,
    scope: 'full',
    compute: computeNoReply,
  },
  {
    key: 'monthly',
    label: '월별 온도',
    grade: 'B',
    requires: ['date', 'continuity'],
    minSamples: 3,
    sampleUnit: '개월',
    sampleCounter: countMonths,
    scope: 'full',
    compute: computeMonthly,
  },
  {
    key: 'changePoint',
    label: '변화점',
    grade: 'B',
    requires: ['date', 'continuity'],
    minSamples: 12,
    sampleUnit: '개월',
    sampleCounter: countMonths,
    scope: 'full',
    compute: (c) => computeMonthly(c).changePoint,
  },
  {
    key: 'phraseGap',
    label: '말버릇 대조',
    grade: 'B',
    requires: ['text'],
    minSamples: 200,
    sampleUnit: '화자당 메시지',
    sampleCounter: countPhraseSamples,
    scope: 'full',
    compute: computePhraseGap,
  },
  {
    key: 'deletedCount',
    label: '삭제 메시지 수',
    grade: 'B',
    // SPEC §5.2 표의 requires는 ['type']이지만 그 표는 이 지표를 캡처에서 ✕로 둔다.
    // 캡처에도 type은 있으므로 ['type']만으로는 ✕가 만들어지지 않는다.
    // 삭제 메시지 총량은 "누락 없음 보장"이 있어야 의미가 있으므로 continuity를 건다.
    requires: ['type', 'continuity'],
    minSamples: 0,
    sampleUnit: '메시지',
    sampleCounter: () => Number.POSITIVE_INFINITY,
    scope: 'full',
    compute: (c) => c.counters.deleted,
  },
  {
    key: 'emojiAffect',
    label: '이모티콘 온도차',
    grade: 'C',
    requires: ['affect'],
    minSamples: 8,
    sampleUnit: '이모티콘',
    sampleCounter: countEmoticons,
    scope: 'full',
    compute: computeEmojiAffect,
  },
  {
    key: 'emojiVariety',
    label: '이모티콘 정서 다양도',
    grade: 'C',
    requires: ['affect'],
    minSamples: 8,
    sampleUnit: '이모티콘',
    sampleCounter: countEmoticons,
    scope: 'full',
    compute: computeEmojiVariety,
  },
]

export const CATALOG_BY_KEY = new Map(CATALOG.map((s) => [s.key, s]))

/** 화면에 필요한 미검증 접근을 막기 위한 헬퍼 */
export function specOf(key: string): MetricSpec {
  const s = CATALOG_BY_KEY.get(key)
  if (!s) throw new Error(`unknown metric: ${key}`)
  return s
}

export {
  countPerSpeakerTexts,
  countMessages,
  countBursts,
  countTransitions,
}
