/**
 * OCR 어댑터 — 좌표만으로 구조를 복원한다.
 *
 * 픽스처는 실제 캡처의 배치를 옮긴 것이다(폭 600 기준).
 * 카톡은 시각을 말풍선 **안쪽** 가장자리에 놓는다 — 오른쪽 말풍선이면 시각이 왼쪽.
 */

import { describe, expect, it } from 'vitest'

import {
  columnOf,
  contentBand,
  countSpeakers,
  detectNameLabels,
  isUiGlyph,
  groupBubbles,
  findHoles,
  isDateDivider,
  isTimeLabel,
  parseDateDivider,
  parseTimeLabel,
  sideOf,
  toMessages,
  type OcrLine,
  type OcrPage,
} from '@/lib/parsers/ocr'

const line = (text: string, box: [number, number, number, number], c = 0.95): OcrLine => ({
  text,
  box,
  confidence: c,
})

/** 민준오빠 대화 — 양쪽이 서로 질문하는 썸 대화 */
const page: OcrPage = {
  width: 600,
  height: 460,
  lines: [
    line('2018년 9월 29일 토요일', [200, 30, 400, 50]),

    // 나 — 연속 발화 2개 (말풍선 사이 간격 넓음)
    line('오빠', [530, 66, 578, 88]),
    line('뭐해?', [520, 102, 578, 124]),
    line('오후 9:11', [455, 106, 512, 122]),

    // 민준오빠 — 이름 라벨 + 말풍선 2개
    line('민준오빠', [62, 138, 118, 154]),
    line('나 집에서 쉬고 있어!', [62, 168, 240, 190]),
    line('어제 회식 타격이 너무 커서ㅠㅠㅋㅋ', [62, 204, 300, 226]),
    line('오후 9:13', [308, 210, 365, 226]),

    // 나 — 멀티라인 한 말풍선 (줄 간격 좁음)
    line('아 진짜 괜찮은거야', [430, 250, 578, 272]),
    line('걱정되서 그래', [430, 276, 578, 298]),
    line('오후 9:14', [365, 282, 422, 298]),

    // 민준오빠
    line('민준오빠', [62, 320, 118, 336]),
    line('아니야 지금은 괜찮아ㅎㅎ', [62, 350, 260, 372]),
    line('너는 뭐해?', [62, 386, 165, 408]),
    line('오후 9:14', [173, 392, 230, 408]),
  ],
}

describe('줄 분류', () => {
  it('시각 라벨을 24시로 정규화한다', () => {
    expect(parseTimeLabel('오후 9:11')).toBe('21:11')
    expect(parseTimeLabel('오전 12:16')).toBe('00:16') // 실제 캡처에 존재하는 자정 케이스
    expect(parseTimeLabel('오후 12:30')).toBe('12:30')
    expect(isTimeLabel('오후 9:11')).toBe(true)
    expect(isTimeLabel('9시에 보자')).toBe(false)
  })

  it('날짜 구분선을 읽는다', () => {
    expect(parseDateDivider('2018년 9월 29일 토요일')).toBe('2018-09-29')
    expect(parseDateDivider('2022년 9월 19일 월요일')).toBe('2022-09-19')
    expect(isDateDivider('내일 9월 29일에 봐')).toBe(false)
  })
})

describe('좌우 판정 — 테마와 무관하다', () => {
  it('오른쪽에 붙은 말풍선은 나', () => {
    expect(sideOf([520, 100, 578, 124], 600)).toBe('me')
  })

  it('왼쪽에 붙은 말풍선은 상대', () => {
    expect(sideOf([62, 100, 240, 124], 600)).toBe('other')
  })

  it('폭이 넓어 중심이 화면 중앙을 넘어도 정렬로 판정한다', () => {
    // 카톡 말풍선은 양쪽 가장자리에 동시에 닿지 않는다(최대 폭 ~70%).
    // 왼쪽 말풍선: 중심 271, 오른쪽 여백이 크다
    expect(sideOf([62, 100, 480, 124], 600)).toBe('other')
    // 오른쪽 말풍선: 중심 349, 왼쪽 여백이 크다
    expect(sideOf([120, 100, 578, 124], 600)).toBe('me')
  })
})

describe('이름 라벨', () => {
  it('반복되는 짧은 텍스트를 이름으로 잡는다', () => {
    const names = detectNameLabels(page)
    expect(names.has('민준오빠')).toBe(true)
  })

  it('메시지 본문을 이름으로 오인하지 않는다', () => {
    const names = detectNameLabels(page)
    expect(names.has('나 집에서 쉬고 있어!')).toBe(false)
    expect(names.has('오후 9:11')).toBe(false)
  })

  it('1:1 대화는 화자 2명', () => {
    expect(countSpeakers(page)).toBe(2)
  })
})

describe('단톡 거절 — PRD §5', () => {
  const group: OcrPage = {
    width: 600,
    height: 400,
    lines: [
      line('최정수', [62, 40, 110, 56]),
      line('어떻게 너는 매번 사람이 그래?', [62, 70, 320, 92]),
      line('오전 12:16', [328, 76, 395, 92]),
      line('김록수', [62, 120, 110, 136]),
      line('그러니까 괜찮다고 했잖아', [62, 150, 300, 172]),
      line('오전 12:16', [308, 156, 375, 172]),
      line('야 싸우지마', [480, 200, 578, 222]),
      line('오전 12:16', [410, 206, 477, 222]),
      line('최정수', [62, 250, 110, 266]),
      line('그러다간 너 잃어 사람의 신용', [62, 280, 330, 302]),
      line('김록수', [62, 320, 110, 336]),
      line('없다고 말했잖아 부작용', [62, 350, 290, 372]),
    ],
  }

  it('왼쪽에 두 사람이 있으면 3명으로 센다', () => {
    expect(countSpeakers(group)).toBe(3)
  })

  it('단톡은 지표를 만들지 않고 거절한다', () => {
    const r = toMessages(group)
    expect(r.rejected).toBe('group_chat')
    expect(r.messages).toHaveLength(0)
  })
})

describe('말풍선 묶기', () => {
  const bubbles = groupBubbles(page)

  it('연속 발화는 나누고 멀티라인은 묶는다', () => {
    const texts = bubbles.map((b) => b.lines.map((l) => l.text).join('\n'))
    expect(texts).toEqual([
      '오빠',
      '뭐해?',
      '나 집에서 쉬고 있어!',
      '어제 회식 타격이 너무 커서ㅠㅠㅋㅋ',
      '아 진짜 괜찮은거야\n걱정되서 그래', // 줄 간격이 좁아 한 말풍선
      '아니야 지금은 괜찮아ㅎㅎ',
      '너는 뭐해?',
    ])
  })

  it('이름 라벨은 메시지에서 빠진다', () => {
    for (const b of bubbles) {
      for (const l of b.lines) expect(l.text).not.toBe('민준오빠')
    }
  })

  it('화자가 교대한다', () => {
    expect(bubbles.map((b) => b.who)).toEqual([
      'me', 'me', 'other', 'other', 'me', 'other', 'other',
    ])
  })

  it('시각을 가장 가까운 말풍선에 붙인다', () => {
    expect(bubbles[1].time).toBe('21:11')
    expect(bubbles[3].time).toBe('21:13')
  })

  it('날짜 구분선 아래 말풍선에 날짜가 물린다', () => {
    for (const b of bubbles) expect(b.date).toBe('2018-09-29')
  })
})

describe('공통 스키마 변환', () => {
  const r = toMessages(page)

  it('거절되지 않고 메시지가 나온다', () => {
    expect(r.rejected).toBeNull()
    expect(r.speakers).toBe(2)
    expect(r.messages.length).toBe(7)
  })

  it('charCount는 grapheme 기준이다', () => {
    const m = r.messages.find((x) => x.text === '오빠')
    expect(m?.charCount).toBe(2)
  })

  it('멀티라인은 개행으로 이어진다', () => {
    const m = r.messages.find((x) => x.text?.includes('걱정되서'))
    expect(m?.text).toContain('\n')
  })
})

describe('비텍스트 발화 검출 — 여백이 주 단서', () => {
  /** 말풍선 간격이 30px인 대화 중간에 128px짜리 스티커가 끼어 있다 */
  const withSticker: OcrPage = {
    width: 600,
    height: 500,
    lines: [
      line('완전 좋아', [500, 40, 578, 62]),
      line('오후 11:14', [420, 46, 490, 62]),
      line('나도 그래', [505, 92, 578, 114]),
      // ── 여기 스티커 (y 144~272). OCR엔 아무것도 안 잡힌다 ──
      line('오후 11:15', [420, 250, 490, 266]),
      line('그래 내일 보자', [450, 302, 578, 324]),
      line('잘 자', [530, 354, 578, 376]),
      line('오후 11:20', [455, 360, 525, 376]),
    ],
  }

  const bubbles = groupBubbles(withSticker)
  const holes = findHoles(withSticker, bubbles)

  it('벌어진 여백을 비텍스트 발화로 잡는다', () => {
    expect(holes).toHaveLength(1)
    expect(holes[0].y[0]).toBeLessThan(holes[0].y[1])
  })

  it('앞뒤 화자가 같으면 그 화자로 확정한다', () => {
    expect(holes[0].who).toBe('me')
    expect(holes[0].confidence).toBeGreaterThan(0.7)
  })

  it('여백 안의 고아 시각을 보조로 붙인다', () => {
    expect(holes[0].time).toBe('23:15')
  })

  it('비텍스트 발화가 Msg 배열에 들어간다 — 빼면 버스트가 잘못 합쳐진다', () => {
    const r = toMessages(withSticker)
    const kinds = r.messages.map((m) => m.type)
    expect(kinds).toContain('nontext')
    // 시간 순서대로 끼어 있어야 한다
    expect(kinds).toEqual(['text', 'text', 'nontext', 'text', 'text'])
    const nt = r.messages.find((m) => m.type === 'nontext')
    expect(nt?.text).toBeNull()
    expect(nt?.charCount).toBe(0)
    expect(r.gaps).toContain('nontext_regions:1')
  })

  it('여백이 없으면 잡지 않는다', () => {
    const even: OcrPage = {
      width: 600,
      height: 300,
      lines: [
        line('완전 좋아', [500, 40, 578, 62]),
        line('나도 그래', [505, 92, 578, 114]),
        line('그래 내일 보자', [450, 144, 578, 166]),
      ],
    }
    expect(findHoles(even, groupBubbles(even))).toHaveLength(0)
  })

  /**
   * 실물(1206×2622)에서 화면 맨 위가 큰 사진이었다. 앞 말풍선이 없어 여백을
   * 견줄 수 없으니 통째로 안 잡혔다.
   *
   * 화자는 시각 라벨로 정하는데, **카톡은 시각을 말풍선 안쪽에 놓는다** —
   * 오른쪽(내) 말풍선이면 시각이 왼쪽이다. 그래서 `sideOf(시각)`을 그대로 쓰면
   * 뒤집힌다. 실측에서 **내가 보낸 사진이 상대 것으로 잡혔다.**
   */
  const topPhoto: OcrPage = {
    width: 600,
    height: 900,
    lines: [
      // ── 내가 보낸 사진 (y 120~500, 오른쪽 정렬). 시각은 사진 왼쪽에 붙는다 ──
      line('오후 2:54', [100, 470, 170, 486]),
      line('졸지마졸지마', [62, 540, 200, 562]),
      line('오후 2:55', [210, 546, 280, 562]),
      line('힐링타임이구나', [62, 592, 210, 614]),
      line('오후 2:56', [220, 598, 290, 614]),
      line('하핫', [520, 644, 578, 666]),
      line('오후 3:00', [450, 650, 512, 666]),
      line('고생이 많다', [62, 700, 190, 722]),
      line('오후 3:01', [200, 706, 270, 722]),
    ],
  }

  it('첫 말풍선 위의 사진도 잡는다', () => {
    const holes = findHoles(topPhoto, groupBubbles(topPhoto))
    expect(holes).toHaveLength(1)
    expect(holes[0].time).toBe('14:54')
  })

  it('시각이 사진 왼쪽에 있으면 내가 보낸 것이다 — 뒤집히면 안 된다', () => {
    expect(findHoles(topPhoto, groupBubbles(topPhoto))[0].who).toBe('me')
  })

  it('시각이 사진 오른쪽에 있으면 상대가 보낸 것이다', () => {
    const theirs: OcrPage = {
      ...topPhoto,
      // 사진이 왼쪽 정렬(x62~470)이면 시각은 그 오른쪽에 붙는다
      lines: topPhoto.lines.map((l) =>
        l.text === '오후 2:54' ? { ...l, box: [480, 470, 550, 486] as const } : l,
      ) as OcrLine[],
    }
    expect(findHoles(theirs, groupBubbles(theirs))[0].who).toBe('other')
  })

  it('날짜 구분선이 벌린 여백은 발화가 아니다', () => {
    // 구분선을 빼고 나면 남는 빈 자리가 말풍선 하나만 못 된다
    const withDivider: OcrPage = {
      width: 600,
      height: 400,
      lines: [
        line('오후 4:36', [200, 40, 270, 56]),
        line('충전~~', [62, 34, 140, 56]),
        line('2026년 7월 24일 금요일', [200, 96, 400, 118]),
        line('엄마 오늘 출근하나?', [420, 152, 578, 174]),
        line('오후 10:42', [340, 158, 412, 174]),
        line('집이여', [62, 204, 140, 226]),
        line('오후 10:43', [150, 210, 222, 226]),
      ],
    }
    expect(findHoles(withDivider, groupBubbles(withDivider))).toHaveLength(0)
  })
})

/**
 * 실물 원본 해상도에서 드러난 것들. 축소본(620폭)에서는 전부 통과했다 —
 * **절대 픽셀 상수와 24시간제**가 원인이었다.
 */
describe('실물 해상도 — 상수가 해상도를 따라가야 한다', () => {
  it('24시간제 시각을 알아본다 — 오전·오후가 없는 경우', () => {
    expect(isTimeLabel('14:55')).toBe(true)
    expect(parseTimeLabel('14:55')).toBe('14:55')
    expect(parseTimeLabel('9:05')).toBe('09:05')
    // 오전·오후가 붙은 기존 형태도 그대로
    expect(parseTimeLabel('오후 3:04')).toBe('15:04')
  })

  it('시각이 아닌 숫자쌍은 거절한다', () => {
    expect(isTimeLabel('25:00')).toBe(false)
    expect(isTimeLabel('14:60')).toBe(false)
    expect(isTimeLabel('2026')).toBe(false)
  })

  it('열은 중앙값이 아니라 가장 조밀한 무리다', () => {
    // 실측 값 그대로 — 진짜 열은 1150 부근인데 중앙값은 1021로 나왔다
    const xs = [675, 793, 940, 947, 1008, 1021, 1107, 1148, 1153, 1161]
    expect(columnOf(xs, 60)).toBeGreaterThan(1100)
  })

  it('UI 아이콘 한 글자는 발화가 아니다', () => {
    for (const g of ['#', '+', '↑', '<']) expect(isUiGlyph(g)).toBe(true)
    // 한 글자 발화는 살아남아야 한다
    for (const t of ['ㅋ', '?', '!', '넹', '.']) expect(isUiGlyph(t)).toBe(false)
  })

  it('날짜 구분선에 꺾쇠가 붙어도 알아본다', () => {
    // 모바일은 구분선이 버튼이라 `>` 아이콘이 같이 잡힌다
    expect(isDateDivider('2026년 8월 1일 토요일>')).toBe(true)
    expect(parseDateDivider('2026년 8월 1일 토요일>')).toBe('2026-08-01')
  })

  it('입력창을 찾으면 그 아래는 대화가 아니다', () => {
    // `#`은 `메시지 입력`과 같은 줄에 있다 — 시각 기반 추정만으로는 못 걸렀다
    const withInput: OcrPage = {
      width: 1206,
      height: 2622,
      lines: [
        line('졸지마졸지마', [184, 1559, 400, 1600]),
        line('오후 2:55', [443, 1604, 524, 1636]),
        line('고생이 많다', [182, 2301, 375, 2342]),
        line('오후 3:01', [417, 2348, 496, 2380]),
        line('메시지 입력', [170, 2423, 374, 2470]),
      ],
    }
    expect(contentBand(withInput)[1]).toBeLessThanOrEqual(2423)
  })

  it('내 말풍선이 열 판정에 잘려나가지 않는다', () => {
    // UI 잔재가 왼쪽에 잔뜩 있고 진짜 내 말풍선은 오른쪽 끝에 붙어 있다
    const hi: OcrPage = {
      width: 1206,
      height: 2622,
      lines: [
        line('엄마다', [534, 207, 675, 240]),
        line('금요일', [700, 219, 793, 250]),
        line('졸지마졸지마', [184, 1559, 400, 1600]),
        line('힐링타임이구나', [183, 1762, 437, 1803]),
        line('하핫', [1069, 1964, 1153, 2005]),
        line('쉬는시간~', [980, 2095, 1148, 2136]),
        line('15:00', [860, 2142, 940, 2174]),
        line('고생이 많다', [182, 2301, 375, 2342]),
      ],
    }
    const texts = groupBubbles(hi).flatMap((b) => b.lines.map((l) => l.text))
    expect(texts).toContain('하핫')
    expect(texts).toContain('쉬는시간~')
  })
})
