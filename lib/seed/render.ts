/**
 * 카톡 화면 렌더러 — TESTPLAN.md §1.3
 *
 * 목적 둘:
 * 1. OCR 어댑터의 임계값을 실제 좌표로 튜닝할 테스트 캡처 생성
 * 2. §4 경로 일치성 테스트 자동화 (txt 구간 → 렌더 → 캡처 → 두 경로 비교)
 *
 * 실물 캡처를 대신하지 않는다. 실물로 기준선을 잡고, 렌더러는 반복 생성용이다.
 */

import type { Msg, Who } from '@/lib/types'

export type RenderOpts = {
  /** 상대 표시명 — 이름 라벨로 렌더된다 */
  otherName?: string
  /** 화면 폭(px). 실제 캡처와 비슷하게 잡는다 */
  width?: number
  /** 다크모드 — 좌우 판정이 색에 의존하지 않는지 확인용 */
  dark?: boolean
  /** 테마 변형 — 노랑(기본) / 파랑 */
  theme?: 'yellow' | 'blue'
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 'HH:mm' → '오전/오후 h:mm' — 카톡은 12시간제로 표시한다 */
export function displayTime(time: string | null): string | null {
  if (!time) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!m) return null
  const h = parseInt(m[1], 10)
  const ampm = h < 12 ? '오전' : '오후'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${ampm} ${h12}:${m[2]}`
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

function displayDate(date: string): string {
  const [y, mo, d] = date.split('-').map(Number)
  const dow = WEEKDAY[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]
  return `${y}년 ${mo}월 ${d}일 ${dow}요일`
}

/** 같은 화자의 연속 메시지 묶음 */
type Group = { who: Who; msgs: Msg[]; date: string | null }

function groupRuns(msgs: Msg[]): Group[] {
  const out: Group[] = []
  for (const m of msgs) {
    const last = out[out.length - 1]
    if (last && last.who === m.who) last.msgs.push(m)
    else out.push({ who: m.who, msgs: [m], date: m.date })
  }
  return out
}

/**
 * 각 메시지의 시각이 화면에 실제로 표시되는지.
 *
 * 카톡은 같은 화자가 **같은 분에** 연달아 보낸 것만 시각을 합쳐 마지막에 한 번
 * 표시한다. 정답지도 이 규칙을 따라야 채점이 맞는다 — 화면에 없는 시각을
 * 파서가 못 읽었다고 감점할 수는 없다.
 */
export function visibleTimes(msgs: Msg[]): boolean[] {
  const shown = new Array<boolean>(msgs.length).fill(false)
  let i = 0
  for (const g of groupRuns(msgs)) {
    g.msgs.forEach((m, j) => {
      const next = g.msgs[j + 1]
      shown[i] = m.time != null && (next == null || next.time !== m.time)
      i += 1
    })
  }
  return shown
}

export function renderKakao(msgs: Msg[], opts: RenderOpts = {}): string {
  const {
    otherName = '하늘',
    width = 720,
    dark = false,
    theme = 'yellow',
  } = opts

  const palette = dark
    ? { bg: '#1b1b1d', other: '#2c2c2e', otherText: '#ededed', time: '#8e8e93', name: '#b0b0b5', divider: '#2c2c2e', dividerText: '#c7c7cc' }
    : { bg: '#b2c7d9', other: '#ffffff', otherText: '#1a1a1a', time: '#7a8a99', name: '#4a5a68', divider: '#8fa6b8', dividerText: '#ffffff' }

  const mine = theme === 'blue' ? '#7b96d4' : '#fef01b'
  const mineText = theme === 'blue' ? '#ffffff' : '#1a1a1a'

  const parts: string[] = []
  let shownDate: string | null = null

  for (const g of groupRuns(msgs)) {
    if (g.date && g.date !== shownDate) {
      shownDate = g.date
      parts.push(`<div class="divider"><span>${esc(displayDate(g.date))}</span></div>`)
    }

    const rows: string[] = []
    g.msgs.forEach((m, i) => {
      // 카톡은 같은 분에 연달아 보낸 것만 시각을 합친다.
      // 분이 바뀌면 중간이라도 표시한다 — 스티커가 시각을 갖는 근거다.
      const next = g.msgs[i + 1]
      const isLast = i === g.msgs.length - 1
      const time = isLast || next.time !== m.time ? displayTime(m.time) : null
      const timeHtml = time ? `<span class="time">${esc(time)}</span>` : ''

      // 이모티콘·사진은 글자가 없다 — OCR에 안 잡히는 영역을 그대로 만든다
      const body =
        m.type === 'text'
          ? `<div class="bubble">${esc(m.text ?? '').split('\n').map((l) => `<div class="line">${l}</div>`).join('')}</div>`
          : `<div class="sticker" aria-hidden="true"></div>`

      rows.push(
        g.who === 'me'
          ? `<div class="row me">${timeHtml}${body}</div>`
          : `<div class="row other">${body}${timeHtml}</div>`,
      )
    })

    if (g.who === 'other') {
      parts.push(
        `<div class="block other">` +
          `<div class="avatar"></div>` +
          `<div class="stack"><div class="name">${esc(otherName)}</div>${rows.join('')}</div>` +
          `</div>`,
      )
    } else {
      parts.push(`<div class="block me"><div class="stack">${rows.join('')}</div></div>`)
    }
  }

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>kakao</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: ${width}px; background: ${palette.bg};
         font-family: "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif;
         padding: 18px 14px; }
  .divider { text-align: center; margin: 18px 0; }
  .divider span { background: ${palette.divider}; color: ${palette.dividerText};
                  font-size: 15px; padding: 5px 14px; border-radius: 14px; }
  .block { display: flex; margin-bottom: 14px; }
  .block.other { justify-content: flex-start; }
  .block.me { justify-content: flex-end; }
  .avatar { width: 42px; height: 42px; border-radius: 14px; background: #cfd8e0;
            flex: 0 0 42px; margin-right: 9px; }
  .stack { display: flex; flex-direction: column; max-width: 68%; }
  .name { font-size: 15px; color: ${palette.name}; margin-bottom: 5px; }
  /* 말풍선 사이 간격 — 한 말풍선 안의 줄 간격보다 확실히 넓다 */
  .row { display: flex; align-items: flex-end; gap: 6px; margin-bottom: 9px; }
  .row.me { justify-content: flex-end; }
  .row.other { justify-content: flex-start; }
  .bubble { border-radius: 14px; padding: 9px 12px; font-size: 19px; line-height: 1.32; }
  .row.me .bubble { background: ${mine}; color: ${mineText}; }
  .row.other .bubble { background: ${palette.other}; color: ${palette.otherText}; }
  .sticker { width: 128px; height: 128px; border-radius: 10px;
             background: repeating-linear-gradient(45deg, #e9a6b8 0 14px, #f2c7d2 14px 28px); }
  .time { font-size: 13px; color: ${palette.time}; white-space: nowrap; padding-bottom: 3px; }
</style></head>
<body>${parts.join('')}</body></html>`
}
