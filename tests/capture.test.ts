/**
 * 캡처 파이프라인 — SPEC.md §4
 *
 * 겹침 제거는 지표 계산 **전 단계**에서 반드시 끝나야 한다.
 * 안 하면 메시지수 비대칭이 통째로 왜곡된다.
 */

import { describe, expect, it } from 'vitest'

import {
  MAX_OVERLAP,
  affectTargets,
  applyEdgePenalty,
  isGroupChat,
  mergeImages,
  mergePair,
  normalizeVisionTime,
  toMessages,
  validateAffect,
  validatePass1,
  type VisionMsg,
  type VisionPass1,
} from '@/lib/parsers/capture'
import { buildCorpus } from '@/lib/corpus'
import { computeHeadline } from '@/lib/stats/headline'

let counter = 0
function vm(
  side: 'left' | 'right',
  text: string | null,
  time: string | null = null,
  type: VisionMsg['type'] = 'text',
): VisionMsg {
  return { i: counter++, side, type, text, time, date: null, confidence: 0.95 }
}

function page(specs: Array<[('l' | 'r'), string, string?]>): VisionMsg[] {
  return specs.map(([s, t, time]) => vm(s === 'r' ? 'right' : 'left', t, time ?? null))
}

describe('시각 정규화', () => {
  it('오전 12시대는 0시가 된다', () => {
    expect(normalizeVisionTime('오전 12:07')).toBe('00:07')
  })
  it('오후는 12를 더한다', () => {
    expect(normalizeVisionTime('오후 1:05')).toBe('13:05')
    expect(normalizeVisionTime('오후 12:30')).toBe('12:30')
  })
  it('표시되지 않았으면 null을 유지한다', () => {
    expect(normalizeVisionTime(null)).toBeNull()
    expect(normalizeVisionTime('알 수 없음')).toBeNull()
  })
})

describe('1패스 스키마 검증 — MODELS §2.1', () => {
  it('정상 응답을 통과시킨다', () => {
    const r = validatePass1({
      isKakaoScreenshot: true,
      distinctSenders: 2,
      messages: [
        { i: 0, side: 'right', type: 'text', text: '오늘 뭐해?', time: '오전 10:23', date: null, confidence: 0.95 },
      ],
    })
    expect(r.ok).toBe(true)
  })

  it('type이 text가 아닌데 text가 채워지면 거절한다', () => {
    const r = validatePass1({
      isKakaoScreenshot: true,
      distinctSenders: 2,
      messages: [
        { i: 0, side: 'left', type: 'emoticon', text: 'ㅋㅋ', time: null, date: null, confidence: 0.9 },
      ],
    })
    expect(r.ok).toBe(false)
    expect(r.errors[0].reason).toContain('type=text')
  })

  it('side와 confidence 범위를 검사한다', () => {
    const r = validatePass1({
      isKakaoScreenshot: true,
      distinctSenders: 2,
      messages: [
        { i: 0, side: 'middle', type: 'text', text: 'x', time: null, date: null, confidence: 1.4 },
      ],
    })
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBe(2)
  })

  it('발신자 수가 없으면 거절한다 — 단톡 감지의 유일한 신호', () => {
    const r = validatePass1({
      isKakaoScreenshot: true,
      messages: [
        { i: 0, side: 'left', type: 'text', text: '안녕', time: null, date: null, confidence: 0.9 },
      ],
    })
    expect(r.ok).toBe(false)
    expect(r.errors[0].reason).toContain('distinctSenders')
  })

  it('3인 이상이면 단톡으로 거절한다 — PRD §5', () => {
    const page = (n: number) =>
      ({ isKakaoScreenshot: true, distinctSenders: n, messages: [] }) as VisionPass1
    expect(isGroupChat([page(2), page(2)])).toBe(false)
    expect(isGroupChat([page(2), page(3)])).toBe(true) // 한 장만 3명이어도 거절
  })

  it('2패스 정서 좌표의 범위를 검사한다', () => {
    expect(
      validateAffect({ i: 1, emoji_desc: '우는 캐릭터', valence: -0.6, intensity: 0.8, confidence: 0.9 }),
    ).toBe(true)
    expect(
      validateAffect({ i: 1, emoji_desc: 'x', valence: -3, intensity: 0.8, confidence: 0.9 }),
    ).toBe(false)
  })
})

describe('겹침 제거 — SPEC §4.2', () => {
  it('겹치는 구간을 한 번만 남긴다', () => {
    const a = page([['r', '오늘 뭐해'], ['l', 'ㅇㅇ'], ['r', '밥 먹었어?'], ['l', '아직'], ['r', '나도']])
    const overlap = a.slice(-3)
    const b = [...overlap, ...page([['l', '이따 보자'], ['r', 'ㅇㅋ']])]

    const { merged, overlap: k } = mergePair(a, b)
    expect(k).toBe(3)
    expect(merged.length).toBe(7)
    expect(merged.map((m) => m.text)).toEqual([
      '오늘 뭐해', 'ㅇㅇ', '밥 먹었어?', '아직', '나도', '이따 보자', 'ㅇㅋ',
    ])
  })

  it('단건 일치로는 병합하지 않는다 (최소 연속 2)', () => {
    const a = page([['r', '가'], ['l', 'ㅇㅇ']])
    const b = page([['l', 'ㅇㅇ'], ['r', '다']])
    const { overlap } = mergePair(a, b)
    expect(overlap).toBe(0)
  })

  it('텍스트만 같고 좌우가 다르면 겹침이 아니다', () => {
    const a = page([['r', 'ㅋㅋ'], ['r', 'ㅇㅇ']])
    const b = page([['l', 'ㅋㅋ'], ['l', 'ㅇㅇ'], ['r', '뭐해']])
    expect(mergePair(a, b).overlap).toBe(0)
  })

  it('같은 텍스트라도 시각이 다르면 겹침이 아니다', () => {
    const a = page([['r', 'ㅇㅇ', '10:01'], ['l', 'ㅋㅋ', '10:02']])
    const b = page([['r', 'ㅇㅇ', '11:41'], ['l', 'ㅋㅋ', '11:42'], ['r', '어디야']])
    expect(mergePair(a, b).overlap).toBe(0)
  })

  it('겹침 15개까지 잡는다', () => {
    const long = page(
      Array.from({ length: 20 }, (_, i) => ['r' as const, `메시지 ${i}`]),
    )
    const b = [...long.slice(-MAX_OVERLAP), ...page([['l', '끝']])]
    const { overlap, merged } = mergePair(long, b)
    expect(overlap).toBe(MAX_OVERLAP)
    expect(merged.length).toBe(21)
  })

  it('겹침이 없으면 scroll_break를 기록한다', () => {
    const p1 = page([['r', 'a'], ['l', 'b']])
    const p2 = page([['r', 'c'], ['l', 'd']])
    const r = mergeImages([p1, p2], ['img1', 'img2'])
    expect(r.gaps).toEqual(['scroll_break:img2'])
    expect(r.messages.length).toBe(4)
  })

  it('4장을 순서대로 병합한다', () => {
    const p1 = page([['r', '1'], ['l', '2'], ['r', '3'], ['l', '4']])
    const p2 = [...p1.slice(-2), ...page([['r', '5'], ['l', '6']])]
    const p3 = [...p2.slice(-2), ...page([['r', '7'], ['l', '8']])]
    const p4 = [...p3.slice(-2), ...page([['r', '9']])]

    const r = mergeImages([p1, p2, p3, p4])
    expect(r.gaps).toEqual([])
    expect(r.removed).toBe(6)
    expect(r.messages.map((m) => m.text)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
  })

  it('병합하지 않으면 메시지수 비대칭이 왜곡된다', () => {
    // 같은 구간이 두 번 세어지면 그 구간의 화자가 유리해진다
    const p1 = page([
      ['r', '길게 쓴 메시지 하나'], ['r', '또 하나'], ['r', '세 번째'], ['l', 'ㅇㅇ'],
    ])
    const p2 = [...p1.slice(-3), ...page([['l', 'ㅋㅋ']])]

    const merged = mergeImages([p1, p2]).messages
    const naive = [...p1, ...p2]

    const tiltOf = (v: VisionMsg[]) =>
      computeHeadline(buildCorpus(toMessages(v), { mode: 'capture' }), null).axes.msgCount

    expect(tiltOf(merged)).not.toBe(tiltOf(naive))
    expect(merged.length).toBeLessThan(naive.length)
  })
})

describe('Msg 변환 — SPEC §4.6', () => {
  it('side를 그대로 신뢰한다 (배경색 판별 없음)', () => {
    const msgs = toMessages(page([['r', '나'], ['l', '상대']]))
    expect(msgs[0].who).toBe('me')
    expect(msgs[1].who).toBe('other')
  })

  it('미디어는 charCount 0을 강제한다', () => {
    const v: VisionMsg[] = [
      vm('right', null, null, 'emoticon'),
      vm('left', '안녕하세요', '오후 3:04'),
    ]
    const msgs = toMessages(v)
    expect(msgs[0].charCount).toBe(0)
    expect(msgs[0].text).toBeNull()
    expect(msgs[1].charCount).toBe(5)
    expect(msgs[1].time).toBe('15:04')
  })

  it('2패스 정서 좌표를 붙인다', () => {
    const v: VisionMsg[] = [vm('right', null, null, 'emoticon')]
    const affects = new Map([
      [v[0].i, { desc: '고개 숙이고 우는 캐릭터', affect: { valence: -0.6, intensity: 0.8 } }],
    ])
    const msgs = toMessages(v, affects)
    expect(msgs[0].affect).toEqual({ valence: -0.6, intensity: 0.8 })
    expect(msgs[0].emojiDesc).toBe('고개 숙이고 우는 캐릭터')
  })

  it('2패스 대상은 이모티콘과 사진뿐이다', () => {
    const v: VisionMsg[] = [
      vm('right', '텍스트'),
      vm('left', null, null, 'emoticon'),
      vm('right', null, null, 'photo'),
      vm('left', null, null, 'voice'),
    ]
    expect(affectTargets(v).map((m) => m.type)).toEqual(['emoticon', 'photo'])
  })

  it('캡처 상하단 말풍선은 신뢰도를 낮춘다 — SPEC §4.5', () => {
    const p = applyEdgePenalty(page([['r', '위'], ['l', '중간'], ['r', '아래']]))
    expect(p[0].confidence).toBeLessThan(p[1].confidence)
    expect(p[2].confidence).toBeLessThan(p[1].confidence)
  })
})
