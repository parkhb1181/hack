/**
 * 파서 골든 — TESTPLAN.md §3.1
 *
 * `unparsedRecords: 0`이 가장 중요한 항목이다.
 * 파서가 조용히 버리는 레코드가 생기면 모든 지표가 틀어진다.
 */

import { describe, expect, it } from 'vitest'

import {
  classifyBody,
  isUnsupported,
  parseTxt,
  resolveWho,
  suggestMerges,
  to24h,
  toMessages,
} from '@/lib/parsers/txt'
import {
  deletedPositions,
  generateSeed,
  renderAndroid,
  renderPC,
  type SeedName,
} from '@/lib/seed/generate'
import { readSeed } from './helpers'

const SEEDS: SeedName[] = ['seed_balanced', 'seed_faded', 'seed_onesided']

describe('시각 정규화 (SPEC §3.6)', () => {
  it('오전 12시는 0시가 된다', () => {
    expect(to24h('오전', 12)).toBe(0)
  })
  it('오후 12시는 그대로 12시', () => {
    expect(to24h('오후', 12)).toBe(12)
  })
  it('오후 1시는 13시', () => {
    expect(to24h('오후', 1)).toBe(13)
  })
  it('오전 9시는 그대로', () => {
    expect(to24h('오전', 9)).toBe(9)
  })
})

describe('본문 분류 (SPEC §3.9)', () => {
  it('미디어는 charCount 오염을 막기 위해 text를 비운다', () => {
    expect(classifyBody('사진')).toEqual({ type: 'photo', text: null })
    expect(classifyBody('사진 3장')).toEqual({ type: 'photo', text: null })
    expect(classifyBody('이모티콘')).toEqual({ type: 'emoticon', text: null })
    expect(classifyBody('음성메시지')).toEqual({ type: 'voice', text: null })
    expect(classifyBody('파일: 계약서.pdf').type).toBe('file')
  })
  it('본문에 사진이라는 단어가 들어간 문장은 텍스트다', () => {
    const r = classifyBody('사진 보내줄게')
    expect(r.type).toBe('text')
    expect(r.text).toBe('사진 보내줄게')
  })
})

describe.each(SEEDS)('%s — 파서 골든', (name) => {
  const events = generateSeed(name)
  const del = deletedPositions(events)

  for (const fmt of ['pc', 'android'] as const) {
    it(`${fmt}: 미분류 레코드 0 · 생성기 원본과 개수 일치`, () => {
      const parsed = parseTxt(readSeed(name, fmt))
      if (isUnsupported(parsed)) throw new Error('unsupported')

      expect(parsed.unparsed).toBe(0)
      expect(parsed.raw.length).toBe(events.length)
      expect(parsed.deleted).toBe(del.length)
      expect(parsed.deleted).toBe(2)
      expect(parsed.source).toBe(fmt === 'pc' ? 'kakao_pc' : 'kakao_android')
    })

    it(`${fmt}: 화자·시각·타입이 생성기 원본과 일치`, () => {
      const parsed = parseTxt(readSeed(name, fmt))
      if (isUnsupported(parsed)) throw new Error('unsupported')
      const who = resolveWho(parsed.title, parsed.speakers)
      expect(who.resolved).toBe(true)

      const msgs = toMessages(parsed.raw, who.map)
      expect(msgs.length).toBe(events.length)

      for (let i = 0; i < events.length; i++) {
        expect(msgs[i].who).toBe(events[i].who)
        expect(msgs[i].ts).toBe(events[i].ts)
        expect(msgs[i].type).toBe(events[i].type)
      }
    })
  }

  it('PC와 안드로이드가 동일한 메시지 배열을 낸다', () => {
    const parse = (fmt: 'pc' | 'android') => {
      const p = parseTxt(readSeed(name, fmt))
      if (isUnsupported(p)) throw new Error('unsupported')
      const w = resolveWho(p.title, p.speakers)
      return { p, msgs: toMessages(p.raw, w.map) }
    }
    const a = parse('pc')
    const b = parse('android')
    expect(b.msgs).toEqual(a.msgs)
    expect(b.p.multiline).toBe(a.p.multiline)
    expect(b.p.midnight).toBe(a.p.midnight)
  })

  it('TESTPLAN §2 케이스가 시드에 실제로 들어있다', () => {
    const p = parseTxt(readSeed(name, 'pc'))
    if (isUnsupported(p)) throw new Error('unsupported')
    expect(p.multiline).toBeGreaterThanOrEqual(5)
    expect(p.midnight).toBeGreaterThanOrEqual(3)
    expect(p.raw.filter((r) => r.type === 'photo').length).toBeGreaterThanOrEqual(10)
    expect(p.raw.filter((r) => r.type === 'emoticon').length).toBeGreaterThanOrEqual(10)
    expect(p.raw.length).toBeGreaterThanOrEqual(400)
  })
})

describe('닉네임 엣지 케이스 (SPEC §3.8)', () => {
  const events = generateSeed('seed_balanced').slice(0, 40)

  it('대괄호를 포함한 닉네임도 정상 파싱된다', () => {
    const txt = renderPC(events, {
      me: 'adsp 최고[2일전사] 80점합격',
      other: '하늘',
    })
    const p = parseTxt(txt)
    if (isUnsupported(p)) throw new Error('unsupported')
    expect(p.unparsed).toBe(0)
    expect(p.speakers.map((s) => s.name).sort()).toEqual(
      ['adsp 최고[2일전사] 80점합격', '하늘'].sort(),
    )
  })

  it('`님`으로 끝나는 닉네임이 시스템 메시지로 오분류되지 않는다', () => {
    // 검사 순서를 뒤집으면 여기서 깨진다 (SPEC §3.4)
    const txt = renderAndroid(events, { me: '민서', other: '시어머니님' })
    const p = parseTxt(txt)
    if (isUnsupported(p)) throw new Error('unsupported')
    expect(p.unparsed).toBe(0)
    expect(p.raw.length).toBe(events.length)
    expect(p.speakers.some((s) => s.name === '시어머니님')).toBe(true)
  })
})

/**
 * 아이폰 내보내기. 실물 두 개를 받아보니 **같은 iOS인데 시각 표기가 갈렸다** —
 * 기기가 24시간제면 `16:06`, 아니면 `오후 4:06`이다. 예전 감지기가 오전/오후를
 * 필수로 봐서 24시간제 파일은 형식 판별조차 안 됐다.
 */
describe('iOS 내보내기', () => {
  const head = ['Talk_2026.7.11 10:53-1.txt', '하늘 : 2026. 7. 11. 11:00', '', '']

  it('오전·오후 표기를 읽는다', () => {
    const p = parseTxt(
      [
        ...head,
        '2026년 7월 11일 토요일',
        '2026. 7. 11. 오전 10:53, 하늘 : 안녕',
        '2026. 7. 11. 오후 10:54, 민서 : 어',
      ].join('\r\n'),
    )
    if (isUnsupported(p)) throw new Error('unsupported')
    expect(p.source).toBe('kakao_ios')
    expect(p.raw).toHaveLength(2)
    expect(p.raw[0].time).toBe('10:53')
    expect(p.raw[1].time).toBe('22:54')
    expect(p.unparsed).toBe(0)
  })

  it('24시간제 표기도 읽는다 — 실물이 이쪽이었다', () => {
    const p = parseTxt(
      [
        ...head,
        '2026년 7월 11일 토요일',
        '2026. 7. 11. 16:06, 하늘 : 안녕',
        '2026. 7. 11. 16:07, 민서 : 어',
      ].join('\r\n'),
    )
    if (isUnsupported(p)) throw new Error('unsupported')
    expect(p.source).toBe('kakao_ios')
    expect(p.raw[0].time).toBe('16:06')
    expect(p.unparsed).toBe(0)
  })

  it('방 이름을 제목으로 잡는다 — iOS엔 `님과 카카오톡 대화` 줄이 없다', () => {
    const p = parseTxt([...head, '2026. 7. 11. 16:06, 민서 : 안녕'].join('\r\n'))
    if (isUnsupported(p)) throw new Error('unsupported')
    expect(p.title).toBe('하늘')
  })

  it('맨 앞 파일명 줄을 못 읽은 줄로 세지 않는다', () => {
    const p = parseTxt([...head, '2026. 7. 11. 16:06, 민서 : 안녕'].join('\r\n'))
    if (isUnsupported(p)) throw new Error('unsupported')
    expect(p.unparsed).toBe(0)
  })
})

describe('화자 병합 제안 (SPEC §3.11)', () => {
  it('시간적으로 겹치지 않는 소수 화자는 동일인 병합을 제안한다', () => {
    const merges = suggestMerges([
      { name: '민서', count: 300, firstDate: '2025-01-01', lastDate: '2025-12-01' },
      { name: '하늘', count: 280, firstDate: '2025-04-01', lastDate: '2025-12-01' },
      { name: '하늘★', count: 40, firstDate: '2025-01-02', lastDate: '2025-03-20' },
    ])
    expect(merges).toEqual([['하늘★', '하늘']])
  })
})

describe('멀티라인 (SPEC §3.1)', () => {
  it('레코드 내부의 순수 LF는 한 메시지로 유지된다', () => {
    const txt = [
      '하늘 님과 카카오톡 대화',
      '--------------- 2025년 1월 6일 월요일 ---------------',
      '[민서] [오전 9:00] 첫 줄\n둘째 줄\n셋째 줄',
      '[하늘] [오전 9:01] ㅇㅇ',
    ].join('\r\n')
    const p = parseTxt(txt)
    if (isUnsupported(p)) throw new Error('unsupported')
    expect(p.raw.length).toBe(2)
    expect(p.raw[0].text).toBe('첫 줄\n둘째 줄\n셋째 줄')
    expect(p.unparsed).toBe(0)
  })
})
