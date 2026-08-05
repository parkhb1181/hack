/**
 * CSV 파서 — 카카오톡 iOS 내보내기
 *
 * 핵심은 하나: **txt와 같은 `ParseResult`로 수렴한다.** 그래야 아래 단계가
 * 입력 종류를 몰라도 된다(SPEC §2).
 */

import { describe, expect, it } from 'vitest'

import { isCsvFailure, parseCsv, parseCsvRows, parseStamp } from '@/lib/parsers/csv'
import { resolveWho, toMessages } from '@/lib/parsers/txt'
import { buildCorpus } from '@/lib/corpus'

const CSV = `Date,User,Message
2026-07-24 10:42:00,"나","엄마 오늘 출근하나?"
2026-07-24 10:43:00,"엄마다","집이여"
2026-07-24 10:43:10,"엄마다","아남"
2026-07-24 11:01:00,"나","내 방에 고데기 코드 뽑았는지 봐줘"
2026-07-24 11:02:00,"엄마다","뽑을 거 없네
안심해"
`

describe('필드 쪼개기 — split(",")로는 안 된다', () => {
  it('따옴표 안의 쉼표를 안 자른다', () => {
    const rows = parseCsvRows('a,"b,c",d')
    expect(rows[0]).toEqual(['a', 'b,c', 'd'])
  })

  it('따옴표 안의 줄바꿈은 같은 레코드다', () => {
    // 카톡 멀티라인 메시지가 정확히 이 모양으로 나온다
    const rows = parseCsvRows('a,"두 줄\n메시지",c')
    expect(rows).toHaveLength(1)
    expect(rows[0][1]).toBe('두 줄\n메시지')
  })

  it('이스케이프된 따옴표를 푼다', () => {
    expect(parseCsvRows('a,"그가 ""안녕"" 이라고",c')[0][1]).toBe('그가 "안녕" 이라고')
  })

  it('빈 줄은 레코드가 아니다', () => {
    expect(parseCsvRows('a,b\n\n\nc,d')).toHaveLength(2)
  })
})

describe('날짜', () => {
  it('ISO 형태를 읽는다', () => {
    expect(parseStamp('2026-07-24 10:42:00')).toEqual({ y: 2026, mo: 7, d: 24, h: 10, mi: 42 })
  })

  it('카톡 iOS 표기를 24시로 정규화한다', () => {
    expect(parseStamp('2018. 6. 25. 오후 8:23')).toEqual({ y: 2018, mo: 6, d: 25, h: 20, mi: 23 })
    expect(parseStamp('2018. 6. 25. 오전 12:16')).toEqual({ y: 2018, mo: 6, d: 25, h: 0, mi: 16 })
    expect(parseStamp('2018. 6. 25. 오후 12:30')).toEqual({ y: 2018, mo: 6, d: 25, h: 12, mi: 30 })
  })

  it('날짜가 아니면 null', () => {
    expect(parseStamp('안녕하세요')).toBeNull()
  })
})

describe('파싱', () => {
  const r = parseCsv(CSV)
  if (isCsvFailure(r)) throw new Error(r.detail)

  it('메시지를 전부 읽는다', () => {
    expect(r.raw).toHaveLength(5)
    expect(r.unparsed).toBe(0)
  })

  it('멀티라인을 한 건으로 묶는다', () => {
    const m = r.raw.find((x) => x.text?.includes('안심해'))
    expect(m?.text).toBe('뽑을 거 없네\n안심해')
    expect(r.multiline).toBe(1)
  })

  it('화자를 센다', () => {
    expect(r.speakers.map((s) => s.name).sort()).toEqual(['나', '엄마다'])
    expect(r.speakers.find((s) => s.name === '엄마다')?.count).toBe(3)
  })

  it('출처를 iOS로 표시한다', () => {
    expect(r.source).toBe('kakao_ios')
  })

  it('제목 줄이 없으므로 title은 null이다 — 화면이 물어야 한다', () => {
    expect(r.title).toBeNull()
    expect(resolveWho(r.title, r.speakers).resolved).toBe(false)
  })

  it('본인을 지정하면 해석된다', () => {
    const who = resolveWho(r.title, r.speakers, '나')
    expect(who.resolved).toBe(true)
    expect(who.map.get('나')).toBe('me')
    expect(who.map.get('엄마다')).toBe('other')
  })

  /**
   * 없는 이름이 통과하면 아무도 'me'에 안 붙어 **전원이 상대**가 되고,
   * 기울기가 한쪽 끝에 박힌 채 그럴듯하게 나온다. 실측으로 당했다 —
   * 균형 대화가 −67(`strong_other`)로 나왔다.
   */
  it('화자 목록에 없는 이름은 해석 실패다 — 조용히 뒤집히면 안 된다', () => {
    const who = resolveWho(r.title, r.speakers, '없는사람')
    expect(who.resolved).toBe(false)
    expect(who.map.size).toBe(0)
  })
})

describe('공통 포맷으로 수렴한다 — SPEC §2', () => {
  const r = parseCsv(CSV)
  if (isCsvFailure(r)) throw new Error(r.detail)
  const msgs = toMessages(r.raw, resolveWho(r.title, r.speakers, '나').map)

  it('txt와 같은 Msg[]를 만든다', () => {
    expect(msgs).toHaveLength(5)
    for (const m of msgs) {
      expect(m.who === 'me' || m.who === 'other').toBe(true)
      expect(typeof m.charCount).toBe('number')
      // 표시명은 여기서 버려진다 — 이름 필드 자체가 없다
      expect(m).not.toHaveProperty('name')
    }
  })

  it('시간축이 선다 — 캡처와 달리 ts가 있다', () => {
    expect(msgs.every((m) => m.ts != null)).toBe(true)
    const c = buildCorpus(msgs, { mode: 'txt', source: 'kakao_ios' })
    expect([...c.availableFields]).toContain('date')
  })

  it('순서가 시간순이다', () => {
    for (let i = 1; i < msgs.length; i++) {
      expect(msgs[i].ts!).toBeGreaterThanOrEqual(msgs[i - 1].ts!)
    }
  })
})

describe('거절', () => {
  it('헤더도 날짜도 없으면 거절한다 — 조용히 틀리지 않는다', () => {
    const r = parseCsv('사과,바나나,포도\n귤,수박,참외')
    expect(isCsvFailure(r)).toBe(true)
  })

  it('행이 하나뿐이면 거절한다', () => {
    expect(isCsvFailure(parseCsv('Date,User,Message'))).toBe(true)
  })

  it('헤더가 없어도 값 모양으로 열을 찾는다', () => {
    const r = parseCsv('2026-07-24 10:42:00,나,안녕하세요 반가워요\n2026-07-24 10:43:00,엄마다,그래')
    if (isCsvFailure(r)) throw new Error(r.detail)
    expect(r.raw).toHaveLength(2)
    expect(r.raw[0].text).toBe('안녕하세요 반가워요')
  })

  it('열 이름이 한국어여도 찾는다', () => {
    const r = parseCsv('날짜,이름,메시지\n2026-07-24 10:42:00,나,안녕')
    if (isCsvFailure(r)) throw new Error(r.detail)
    expect(r.raw[0].name).toBe('나')
  })
})
