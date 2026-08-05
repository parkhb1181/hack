/**
 * 코사인이 "호감"을 재는지 확인 — `npx tsx scripts/bench/sync-valence.ts`
 *
 * 동조율은 두 문장이 의미적으로 가까운 정도다. 그 가까움이 다정해서 생긴
 * 것인지 싸워서 생긴 것인지 구분하지 못한다면, 절대값을 화면에 쓰면 안 된다.
 */

import { cosine } from '@/lib/semantic/metrics'
import { embedTexts } from '@/lib/semantic/ollama'

type Case = { kind: string; a: string; b: string }

const cases: Case[] = [
  { kind: '다정한 맞물림', a: '오늘 좀 힘들었어', b: '무슨 일 있었어?' },
  { kind: '다정한 맞물림', a: '나 이제 자러 갈게', b: '잘 자 푹 쉬어' },
  { kind: '싸우는 맞물림', a: '나도 더는 돈이 없어', b: '한번만 부탁하자 안 빌릴게' },
  { kind: '싸우는 맞물림', a: '돈 없다니까', b: '돈 없고 출근해' },
  { kind: '싸우는 맞물림', a: '왜 자꾸 연락 안 받아', b: '연락 좀 그만해' },
  { kind: '거절', a: '내일 만날래?', b: '미안 그날 바빠' },
  { kind: '어긋남', a: '오늘 좀 힘들었어', b: '나 오늘 치킨 먹었어' },
  { kind: '어긋남', a: '우리 자주 보자', b: '내일 비 온대' },
]

const texts = cases.flatMap((c) => [c.a, c.b])
const { vectors } = await embedTexts(texts)

const rows = cases.map((c, i) => ({
  ...c,
  cos: cosine(vectors[i * 2], vectors[i * 2 + 1]),
}))

rows.sort((x, y) => y.cos - x.cos)

console.log('코사인  유형            A → B')
console.log('─'.repeat(72))
for (const r of rows) {
  console.log(
    `${r.cos.toFixed(3)}   ${r.kind.padEnd(14)}  ${r.a}  →  ${r.b}`,
  )
}

const avg = (k: string) => {
  const xs = rows.filter((r) => r.kind === k).map((r) => r.cos)
  return xs.reduce((a, b) => a + b, 0) / xs.length
}
console.log('\n유형별 평균')
for (const k of ['다정한 맞물림', '싸우는 맞물림', '거절', '어긋남']) {
  console.log(`  ${k.padEnd(14)} ${avg(k).toFixed(3)}`)
}
