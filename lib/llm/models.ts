/**
 * 모델 선택과 폴백 — 한 곳에서만 정한다.
 *
 * **무료 한도는 모델별로 따로 찬다.** 하나가 429를 뱉기 시작하면 다른 모델은
 * 멀쩡한 경우가 많다(실측: `flash-lite`는 되는데 `2.0-flash` 계열이 전부
 * `RESOURCE_EXHAUSTED`). 그때마다 코드를 고치는 대신, **429·403·404를 만나면
 * 다음 후보로 넘어간다.**
 *
 * 넘어가지 않는 오류도 있다. 400(잘못된 요청)이나 500(서버 오류)은 모델을
 * 바꿔도 같은 결과이므로 그대로 던진다 — 넘어가면 진짜 버그가 조용히 숨는다.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * 텍스트 해석 후보 — 가벼운 것부터.
 *
 * 순서에 근거가 있다(실측, 같은 프롬프트 3회):
 *   `flash-lite` 1.1초 · `flash` 10.0초. flash는 사고 모델이라 §6의 12초
 *   타임아웃에 3번 중 2번 걸렸다. 그리고 무거운 모델일수록 한도를 빨리 쓴다.
 */
export const TEXT_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
]

/**
 * 비전 후보. 조각 판독 품질은 세 모델이 같았다(실측: "침대에 엎드린 고양이")
 * — 그래서 여기서도 속도와 한도 여유가 기준이다.
 */
export const VISION_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
]

/** 다음 후보로 넘어갈 상태 코드 — 이 모델이 지금 못 쓰는 상태라는 뜻 */
const SWITCHABLE = new Set([429, 403, 404])

export class GeminiExhausted extends Error {
  constructor(readonly tried: string[], readonly last: string) {
    super(`쓸 수 있는 모델이 없습니다 (시도: ${tried.join(', ')}) — ${last}`)
    this.name = 'GeminiExhausted'
  }
}

function apiKey(): string {
  const k = process.env.GEMINI_API_KEY
  if (!k) throw new Error('GEMINI_API_KEY 없음')
  return k
}

/**
 * 환경변수로 못 박으면 그 하나만 쓴다. 데모 중 모델이 바뀌면 결과가 흔들리므로
 * 고정할 수단이 필요하다.
 */
export function candidates(kind: 'text' | 'vision'): string[] {
  const pin = kind === 'vision' ? process.env.GEMINI_VISION_MODEL : process.env.GEMINI_MODEL
  if (pin) return [pin]
  return kind === 'vision' ? VISION_MODELS : TEXT_MODELS
}

export type GeminiCall = {
  body: Record<string, unknown>
  signal?: AbortSignal
}

export type GeminiOk = {
  /** 실제로 응답한 모델 — 화면에 그대로 표시한다 */
  model: string
  text: string
  /** 429 등으로 건너뛴 모델들 */
  skipped: Array<{ model: string; why: string }>
}

/**
 * 후보를 순서대로 시도하고, 처음 성공한 응답을 돌려준다.
 *
 * 어떤 모델이 왜 건너뛰어졌는지 함께 돌려준다 — 개발자 모드에서 "지금 왜 이
 * 모델을 쓰고 있는가"가 보여야 한다.
 */
export async function callGemini(kind: 'text' | 'vision', call: GeminiCall): Promise<GeminiOk> {
  const key = apiKey()
  const list = candidates(kind)
  const skipped: GeminiOk['skipped'] = []
  let last = ''

  for (const model of list) {
    let res: Response
    try {
      res = await fetch(`${ENDPOINT}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: call.signal,
        body: JSON.stringify(call.body),
      })
    } catch (e) {
      // 타임아웃·중단은 모델 문제가 아니다. 다음 모델도 마찬가지이므로 멈춘다.
      throw e
    }

    if (!res.ok) {
      const body = (await res.text()).replace(/\s+/g, ' ')
      last = `${res.status} ${body.slice(0, 120)}`
      if (SWITCHABLE.has(res.status)) {
        const status = /"status":\s*"([A-Z_]+)"/.exec(body)?.[1] ?? String(res.status)
        skipped.push({ model, why: `${res.status} ${status}` })
        continue
      }
      // 400·500 등은 모델을 바꿔도 같다. 조용히 넘기면 진짜 버그가 숨는다.
      throw new Error(last)
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    if (!text.trim()) {
      skipped.push({ model, why: '빈 응답' })
      last = '빈 응답'
      continue
    }
    return { model, text: text.trim(), skipped }
  }

  throw new GeminiExhausted(list, last)
}
