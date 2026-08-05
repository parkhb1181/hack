/**
 * 글자 수 세기 — SPEC.md §2의 "미디어가 분량을 오염시키지 않는다"를
 * 이모지에도 적용한다.
 */

import { describe, expect, it } from 'vitest'

import { josa, countableLength, graphemeCount, hasEmoji, isEmojiOnly } from '@/lib/text'

describe('grapheme 단위로 센다', () => {
  it.each([
    ['안녕하세요', 5],
    ['😃😃😃😃', 4], // .length는 8
    ['👨‍👩‍👧', 1], // .length는 8 — ZWJ 결합 가족 이모지
    ['🇰🇷', 1], // .length는 4 — 국기
    ['ㅋㅋㅋ', 3],
    ['', 0],
  ])('%s → %i', (s, n) => {
    expect(graphemeCount(s)).toBe(n)
  })

  it('UTF-16 길이와 다르다는 것이 요점이다', () => {
    expect('😃😃😃😃'.length).toBe(8)
    expect(graphemeCount('😃😃😃😃')).toBe(4)
    expect('👨‍👩‍👧'.length).toBe(8)
    expect(graphemeCount('👨‍👩‍👧')).toBe(1)
  })
})

describe('이모지 판정', () => {
  it('이모지가 섞였는지 본다', () => {
    expect(hasEmoji('완전 좋아 😃')).toBe(true)
    expect(hasEmoji('완전 좋아')).toBe(false)
    expect(hasEmoji('ㅋㅋㅋ')).toBe(false)
  })

  it('이모지만 있는 메시지를 가려낸다', () => {
    expect(isEmojiOnly('😃😃😃😃')).toBe(true)
    expect(isEmojiOnly('😃 😃')).toBe(true)
    expect(isEmojiOnly('완전 좋아 😃')).toBe(false)
    expect(isEmojiOnly('ㅋㅋㅋ')).toBe(false)
    expect(isEmojiOnly('')).toBe(false)
  })
})

describe('분량으로 셀 글자 수', () => {
  it('이모지는 분량에서 빠진다 — 정서 신호이지 분량이 아니다', () => {
    expect(countableLength('😃😃😃😃')).toBe(0)
    expect(countableLength('완전 좋아 😃')).toBe(5) // '완전 좋아'
  })

  it('일반 텍스트는 그대로 센다', () => {
    expect(countableLength('오늘 좀 힘들었어')).toBe(9)
    expect(countableLength('ㅇㅇ')).toBe(2)
  })

  it('이모지를 많이 쓰는 쪽이 길이 축에서 유리해지지 않는다', () => {
    const emojiHeavy = '좋아 😃😃😃😃😃😃😃😃'
    const plain = '좋아'
    expect(countableLength(emojiHeavy)).toBe(countableLength(plain))
  })
})

/**
 * 조사를 문자열에 박아두면 반드시 틀린다 — 실측으로 두 번 나갔다.
 *   `상대이 51% 보냈고`   (폴백 문장)
 *   `세션가 더 필요합니다` (지표 카드)
 */
describe('조사 — 받침에 맞춰 붙인다', () => {
  it.each([
    ['상대', '상대가'],
    ['당신', '당신이'],
    ['세션', '세션이'],
    ['개월', '개월이'],
    ['메시지', '메시지가'],
    ['화자', '화자가'],
  ])('%s → %s', (word, want) => {
    expect(josa(word, '이/가')).toBe(want)
  })

  it('다른 조사 쌍도 같은 규칙이다 — 앞이 항상 받침 있을 때', () => {
    expect(josa('사진', '을/를')).toBe('사진을')
    expect(josa('메시지', '을/를')).toBe('메시지를')
    expect(josa('이모티콘', '은/는')).toBe('이모티콘은')
    expect(josa('상대', '은/는')).toBe('상대는')
    // 이 쌍만 받침 쪽이 `과`다 — 관용 표기 `와/과`로 쓰면 뒤집힌다
    expect(josa('이모티콘', '과/와')).toBe('이모티콘과')
    expect(josa('상대', '과/와')).toBe('상대와')
  })

  it('한글이 아니면 받침 없는 쪽으로 둔다', () => {
    // 숫자·영문은 읽는 방식이 갈려 받침을 단정할 수 없다
    expect(josa('OCR', '이/가')).toBe('OCR가')
    expect(josa('120', '이/가')).toBe('120가')
  })
})
