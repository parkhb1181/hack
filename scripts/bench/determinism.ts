/**
 * 임베딩이 결정론적인지 확인 — `npx tsx scripts/bench/determinism.ts`
 *
 * 이 축을 헤드라인에 섞어도 되는지의 핵심 조건이다.
 * 같은 입력에 같은 벡터가 나오지 않으면 골든 테스트와 TESTPLAN §7이 깨진다.
 */

import { cosine } from '@/lib/semantic/metrics'
import { clearEmbedCache, embedTexts } from '@/lib/semantic/ollama'

const texts = [
  '오늘 좀 힘들었어',
  '무슨 일 있었어?',
  '아까 말한 그거 생각해봤는데 아무래도 다음 주에 하는 게 나을 것 같아',
]

const runs: number[][][] = []
for (let i = 0; i < 3; i++) {
  clearEmbedCache() // 캐시를 지워 매번 모델을 실제로 호출한다
  const { vectors } = await embedTexts(texts)
  runs.push(vectors)
}

console.log('회차 간 비교 (캐시 없이 매번 재호출)\n')
for (let t = 0; t < texts.length; t++) {
  const base = runs[0][t]
  const sims: string[] = []
  let maxDiff = 0
  for (let r = 1; r < runs.length; r++) {
    const v = runs[r][t]
    sims.push(cosine(base, v).toFixed(9))
    for (let d = 0; d < base.length; d++) {
      maxDiff = Math.max(maxDiff, Math.abs(base[d] - v[d]))
    }
  }
  console.log(`"${texts[t].slice(0, 20)}${texts[t].length > 20 ? '…' : ''}"`)
  console.log(`  1회차와의 코사인: ${sims.join(', ')}`)
  console.log(`  성분 최대 오차:   ${maxDiff.toExponential(3)}\n`)
}

// 생성 모델과 비교: 같은 프롬프트를 두 번 돌리면?
const gen = async () => {
  const r = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gemma3:4b',
      prompt: '"오늘 좀 힘들었어"에 대한 답장을 한 문장으로 써.',
      stream: false,
      options: { num_predict: 40 },
    }),
  })
  return ((await r.json()) as { response: string }).response.trim().replace(/\s+/g, ' ')
}

console.log('대조군 — 생성 모델 같은 프롬프트 3회')
for (let i = 0; i < 3; i++) console.log(`  [${i + 1}] ${await gen()}`)
