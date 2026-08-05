/**
 * 로컬 임베딩 클라이언트 (Ollama)
 *
 * 서버 로컬 추론 — MODELS.md §3. 텍스트가 제3자로 나가지 않는다.
 */

import { l2norm, type Vec } from './metrics'

export const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
export const EMBED_MODEL = process.env.EMBED_MODEL ?? 'bge-m3'

/** 배치 크기 64~128 — MODELS §3.3 */
export const BATCH_SIZE = 64

export type EmbedStats = {
  /** 임베딩한 문장 수 */
  count: number
  /** 벡터 차원 */
  dim: number
  /** 전체 소요 ms */
  ms: number
  /** 캐시로 건너뛴 문장 수 */
  cacheHits: number
}

/** 동일 텍스트 해시 캐싱 — 반복 표현 비중이 상당하다(MODELS §3.3) */
const cache = new Map<string, Vec>()

export function clearEmbedCache(): void {
  cache.clear()
}

async function embedBatch(texts: string[], model: string): Promise<Vec[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: texts }),
  })
  if (!res.ok) {
    throw new Error(`ollama /api/embed ${res.status}: ${await res.text()}`)
  }
  const json = (await res.json()) as { embeddings: number[][] }
  return json.embeddings.map(l2norm)
}

/**
 * 텍스트 배열 → 벡터 배열 (입력 순서 유지).
 *
 * 벡터는 L2 정규화해서 돌려주므로 코사인 = 내적이다.
 */
export async function embedTexts(
  texts: string[],
  model: string = EMBED_MODEL,
): Promise<{ vectors: Vec[]; stats: EmbedStats }> {
  const started = Date.now()
  let cacheHits = 0

  const need: string[] = []
  const needIndex = new Map<string, number[]>()
  texts.forEach((t, i) => {
    if (cache.has(t)) {
      cacheHits += 1
      return
    }
    const at = needIndex.get(t)
    if (at) at.push(i)
    else {
      needIndex.set(t, [i])
      need.push(t)
    }
  })

  for (let i = 0; i < need.length; i += BATCH_SIZE) {
    const slice = need.slice(i, i + BATCH_SIZE)
    const vecs = await embedBatch(slice, model)
    slice.forEach((t, j) => cache.set(t, vecs[j]))
  }

  const vectors = texts.map((t) => cache.get(t) as Vec)
  return {
    vectors,
    stats: {
      count: texts.length,
      dim: vectors[0]?.length ?? 0,
      ms: Date.now() - started,
      cacheHits,
    },
  }
}
