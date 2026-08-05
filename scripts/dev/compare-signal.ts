/** 같은 대화를 LLM 확률 vs 지표 신호로 비교 — `npx tsx scripts/dev/compare-signal.ts` */

import { buildCorpus } from '@/lib/corpus'
import { computeCrushSignal } from '@/lib/stats/crush'
import { bandLabel, computeHeadline } from '@/lib/stats/headline'
import type { Msg, Who } from '@/lib/types'

const raw: Array<[Who, string]> = [
  ['other', '오랜만이지? 맨날 심심이만 보다가!'],
  ['me', '완전 좋아'],
  ['other', '우리 자주자주 보자'],
  ['me', '오늘 좀 힘들었어'],
  ['other', '무슨 일 있었어?'],
  ['me', '그냥 회사가 좀'],
  ['other', '밥은 먹었어?'],
]

const msgs: Msg[] = raw.map(([who, text], i) => ({
  seq: i,
  who,
  ts: null,
  date: null,
  time: null,
  type: 'text',
  text,
  charCount: [...text].length,
  emojiDesc: null,
  affect: null,
  confidence: 1,
}))

const c = buildCorpus(msgs, { mode: 'capture' })
const h = computeHeadline(c, null)
const sig = computeCrushSignal(c, null)

console.log(`기울기 ${h.tilt} → ${bandLabel(h.band, 'crush')}`)
console.log(`신호 ${sig.score} (${sig.axesUsed}/${sig.axesTotal}축, 정밀도하향 ${sig.precisionReduced})\n`)
for (const x of sig.components) {
  console.log(`  ${x.label.padEnd(7)} ${String(x.raw).padStart(6)}   ${x.detail}`)
}
console.log(`\n${sig.disclaimer}`)
