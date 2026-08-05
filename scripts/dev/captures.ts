/**
 * 테스트 캡처용 HTML 생성 — `npx tsx scripts/dev/captures.ts`
 *
 * OCR 어댑터 임계값 튜닝에 필요한 케이스를 한 화면에 모은다:
 * 연속 발화 / 멀티라인 / 이름 라벨 / 날짜 구분선 / 자정 시각 / 스티커 자리
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderKakao, visibleTimes } from '@/lib/seed/render'
import type { Msg, MsgType, Who } from '@/lib/types'

const OUT = join(process.cwd(), 'fixtures', 'render')
mkdirSync(OUT, { recursive: true })

type Row = [Who, string | null, string | null, MsgType?]

/** 자정 넘김 + 연속 발화 + 멀티라인 + 스티커를 모두 포함한다 */
const rows: Row[] = [
  ['me', '오빠', '23:58', 'text'],
  ['me', '뭐해?', '23:58', 'text'],
  ['other', '나 집에서 쉬고 있어!', null, 'text'],
  ['other', '어제 회식 타격이 너무 커서ㅠㅠㅋㅋ', '23:59', 'text'],
  ['me', '아 진짜 괜찮은거야\n걱정되서 그래', '00:03', 'text'],
  ['other', null, '00:05', 'emoticon'],
  ['other', '아니야 지금은 괜찮아ㅎㅎ', null, 'text'],
  ['other', '너는 뭐해?', '00:06', 'text'],
  ['me', '나도 이제 자려고\n내일 일찍 나가야 해서', '00:12', 'text'],
]

const msgs: Msg[] = rows.map(([who, text, time, type = 'text'], i) => ({
  seq: i,
  who,
  ts: null,
  date: '2026-08-04',
  time,
  type,
  text: type === 'text' ? text : null,
  charCount: type === 'text' ? [...(text ?? '')].length : 0,
  emojiDesc: null,
  affect: null,
  confidence: 1,
}))

const variants = [
  { name: 'kakao_yellow', opts: {} },
  { name: 'kakao_blue', opts: { theme: 'blue' as const } },
  { name: 'kakao_dark', opts: { dark: true } },
]

for (const v of variants) {
  const html = renderKakao(msgs, { otherName: '민준오빠', width: 720, ...v.opts })
  const path = join(OUT, `${v.name}.html`)
  writeFileSync(path, html, 'utf8')
  console.log(`${v.name}.html  (${html.length}B)`)
}

// 정답지 — OCR 결과를 이것과 대조한다.
// 화면에 실제로 표시되는 시각만 기록한다(§2 "같은 분 연속 발화는 마지막만 표시")
const shown = visibleTimes(msgs)
const truth = msgs.map((m, i) => ({
  who: m.who,
  type: m.type,
  text: m.text,
  time: shown[i] ? m.time : null,
}))
writeFileSync(join(OUT, 'truth.json'), JSON.stringify(truth, null, 2), 'utf8')
console.log(`truth.json  (메시지 ${truth.length}개, 스티커 1개 포함)`)
console.log(`\nwrote to ${OUT}`)
