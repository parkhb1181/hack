/**
 * Vision 2패스 — 비텍스트 발화의 종류와 정서를 읽는다.
 *
 * **조각만 보낸다.** 전체 캡처가 아니라 OCR·여백 검출이 찾아낸 구간만 오려서
 * 보내므로 대화 글자가 외부로 나가지 않는다(MODELS §2.2).
 *
 * 이 층은 `PRD.md` §4.1의 "모델은 데이터를 만들 수 있다"에 해당한다 —
 * 그림에서 정서를 읽는 규칙 기반 방법은 존재하지 않는다. 실패하면 폴백 없이
 * C급 지표만 `LOCKED`가 되고 헤드라인은 영향받지 않는다(SPEC §9.3).
 */

import { callGemini, candidates } from '@/lib/llm/models'
import type { Affect, MsgType } from '@/lib/types'

/**
 * 첫 후보. **고정이 아니다** — 한도가 차면 `lib/llm/models.ts`가 다음으로 넘어간다.
 *
 * 실측(조각 1개, 실물 사진): `flash-lite` 1.09초 / `flash-latest` 3.37초 /
 * `3.6-flash` 4.35초. 판독 내용은 셋 다 같았다("침대에 엎드린 고양이").
 * 그래서 순서 기준은 품질이 아니라 속도와 한도 여유다.
 */
export const GEMINI_MODEL = candidates('vision')[0]

/** MODELS.md §2.2 프롬프트 — 문구는 그 문서에서만 바꾼다 */
export const AFFECT_PROMPT = `카카오톡 대화에서 오려낸 조각들이다. 각 조각에는 글자가 아닌 발화
(이모티콘 스티커 또는 사진)가 하나씩 들어 있다.

각 조각에 대해:
- kind: "emoticon"(카카오 스티커·캐릭터 그림) 또는 "photo"(사진) 중 하나.
  판단이 안 되면 "emoticon".
- emoji_desc: 무엇이 그려져 있는지 15자 이내 사실 서술.
  감정 해석이나 맥락 추측을 넣지 않는다.
  좋은 예: "고개 숙이고 우는 캐릭터"
  나쁜 예: "슬퍼하며 위로를 바라는 모습"
- valence: -1.0(부정) ~ +1.0(긍정)
- intensity: 0.0(약함) ~ 1.0(강함)
- confidence: 0.0 ~ 1.0

판단이 어려우면 valence 0, intensity 0.3으로 두고 confidence를 0.4
이하로 낮춘다. 추측해서 극단값을 주지 않는다.

사람 얼굴이 포함된 사진은 emoji_desc를 "인물 사진"으로만 적고
구체적 묘사를 하지 않는다. 조각에 글자가 보여도 옮겨 적지 않는다.

조각이 비어 있거나 무엇인지 알 수 없으면 kind를 "emoticon",
confidence를 0.0으로 두고 emoji_desc를 "판독 불가"로 적는다.

아래 JSON만 출력한다. 조각 순서대로, 조각 수만큼 항목을 낸다.`

export type AffectItem = {
  i: number
  kind: 'emoticon' | 'photo'
  emoji_desc: string
  valence: number
  intensity: number
  confidence: number
}

export type AffectResult = {
  type: MsgType
  emojiDesc: string
  affect: Affect
  confidence: number
}

export class GeminiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'GeminiError'
  }
}

function inRange(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
}

/** MODELS §2.2 검증 — 범위를 벗어나면 그 항목은 버린다 */
export function validateAffectItem(raw: unknown): AffectItem | null {
  const o = raw as Partial<AffectItem>
  if (o?.kind !== 'emoticon' && o?.kind !== 'photo') return null
  if (typeof o.emoji_desc !== 'string' || o.emoji_desc.length === 0) return null
  if (!inRange(o.valence, -1, 1)) return null
  if (!inRange(o.intensity, 0, 1)) return null
  if (!inRange(o.confidence, 0, 1)) return null
  return {
    i: typeof o.i === 'number' ? o.i : -1,
    kind: o.kind,
    emoji_desc: o.emoji_desc.slice(0, 30),
    valence: o.valence,
    intensity: o.intensity,
    confidence: o.confidence,
  }
}

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          kind: { type: 'string', enum: ['emoticon', 'photo'] },
          emoji_desc: { type: 'string' },
          valence: { type: 'number' },
          intensity: { type: 'number' },
          confidence: { type: 'number' },
        },
        required: ['i', 'kind', 'emoji_desc', 'valence', 'intensity', 'confidence'],
      },
    },
  },
  required: ['items'],
} as const

function apiKey(): string {
  const k = process.env.GEMINI_API_KEY
  if (!k) throw new GeminiError(0, 'GEMINI_API_KEY 가 설정되지 않았습니다')
  return k
}

/**
 * 조각 여러 장을 **한 번의 호출**로 판독한다.
 *
 * 무료 티어는 분당 요청 수가 빡빡하다 — 조각마다 호출하면 이모티콘 3개짜리
 * 캡처가 호출 3회가 된다.
 */
export async function readAffect(
  cropsBase64: string[],
  signal?: AbortSignal,
): Promise<Array<AffectResult | null>> {
  return (await readAffectDetailed(cropsBase64, signal)).items
}

export type AffectRun = {
  items: Array<AffectResult | null>
  /** 실제로 응답한 모델 */
  model: string
  /** 한도 등으로 건너뛴 모델들 */
  skipped: Array<{ model: string; why: string }>
}

export async function readAffectDetailed(
  cropsBase64: string[],
  signal?: AbortSignal,
): Promise<AffectRun> {
  if (cropsBase64.length === 0) {
    return { items: [], model: candidates('vision')[0], skipped: [] }
  }

  const parts: Array<Record<string, unknown>> = [{ text: AFFECT_PROMPT }]
  cropsBase64.forEach((b64, i) => {
    parts.push({ text: `조각 ${i}` })
    parts.push({ inline_data: { mime_type: 'image/png', data: b64 } })
  })

  // 한도가 차면 다음 후보로 넘어간다 — 모델을 손으로 갈아끼우지 않는다
  const res = await callGemini('vision', {
    signal,
    body: {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
      },
    },
  })
  const text = res.text

  let parsed: { items?: unknown[] }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new GeminiError(200, `JSON 파싱 실패: ${text.slice(0, 120)}`)
  }

  // 조각 순서대로 맞춘다. 개수가 어긋나면 남는 자리는 null로 둔다.
  const out: Array<AffectResult | null> = new Array(cropsBase64.length).fill(null)
  ;(parsed.items ?? []).forEach((raw, idx) => {
    const item = validateAffectItem(raw)
    if (!item) return
    const slot = item.i >= 0 && item.i < out.length ? item.i : idx
    if (slot >= out.length) return
    out[slot] = {
      type: item.kind,
      emojiDesc: item.emoji_desc,
      affect: { valence: item.valence, intensity: item.intensity },
      confidence: item.confidence,
    }
  })
  return { items: out, model: res.model, skipped: res.skipped }
}
