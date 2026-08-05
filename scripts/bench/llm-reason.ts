/** LLM에게 확률과 그 이유를 함께 물어 일관성을 본다 — `npx tsx scripts/bench/llm-reason.ts` */

export {}

const convo = `상대: 오랜만이지? 맨날 심심이만 보다가!
나: 완전 좋아
상대: 우리 자주자주 보자
나: 오늘 좀 힘들었어
상대: 무슨 일 있었어?
나: 그냥 회사가 좀
상대: 밥은 먹었어?`

const ask = `다음 카톡 대화를 보고 두 사람이 이어질 확률을 답해.
형식: "확률: N% / 이유: (한 문장)"

${convo}`

const rows: string[] = []
for (let i = 0; i < 4; i++) {
  const res = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gemma3:4b',
      prompt: ask,
      stream: false,
      options: { num_predict: 90 },
    }),
  })
  const j = (await res.json()) as { response: string }
  const line = j.response.trim().replace(/\s+/g, ' ')
  rows.push(line)
  console.log(`[${i + 1}] ${line}\n`)
}

const nums = rows.map((r) => r.match(/(\d+)\s*%/)?.[1]).filter(Boolean)
console.log(`확률값: ${nums.join(', ')}`)
