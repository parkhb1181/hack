/**
 * 지금 실제로 쓸 수 있는 모델 찾기 — `npx tsx scripts/check/quota.ts`
 *
 * 목록에 있다고 쓸 수 있는 게 아니다. 무료 한도는 **모델별로** 따로 차므로,
 * 진짜로 한 번 태워봐야 안다. 텍스트와 비전을 각각 확인한다.
 */

import { loadEnvLocal } from '@/lib/env'
loadEnvLocal()

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { findHoles, groupBubbles, type OcrPage } from '@/lib/parsers/ocr'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const KEY = process.env.GEMINI_API_KEY ?? ''

/** 후보 — 가벼운 것부터. 무거운 모델일수록 한도를 빨리 소진한다 */
const CANDIDATES = [
  'gemini-flash-lite-latest',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-lite-001',
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-pro-latest',
  'gemini-2.5-pro',
]

/** 비전 확인용 조각 하나 — 실제 파이프라인이 만드는 것과 같은 모양 */
function crop(): string | null {
  try {
    const page = JSON.parse(
      readFileSync(join(process.cwd(), 'fixtures', 'real', 'mom_03.ocr.json'), 'utf8'),
    ) as OcrPage
    const holes = findHoles(page, groupBubbles(page))
    if (holes.length === 0) return null
    return JSON.stringify(holes[0].y)
  } catch {
    return null
  }
}

async function tryModel(
  model: string,
  parts: Array<Record<string, unknown>>,
): Promise<{ ok: boolean; ms: number; note: string }> {
  const t0 = Date.now()
  try {
    const res = await fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(KEY)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({ contents: [{ role: 'user', parts }] }),
    })
    const body = await res.text()
    if (!res.ok) {
      const code = /"status":\s*"([A-Z_]+)"/.exec(body)?.[1] ?? String(res.status)
      return { ok: false, ms: Date.now() - t0, note: `${res.status} ${code}` }
    }
    const json = JSON.parse(body) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    return { ok: true, ms: Date.now() - t0, note: text.replace(/\s+/g, ' ').slice(0, 50) }
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, note: e instanceof Error ? e.message.slice(0, 40) : '실패' }
  }
}

/* ------------------------------ 텍스트 ------------------------------ */

console.log('■ 텍스트 (해석용)\n')
const textParts = [{ text: '숫자 7만 출력해라. 다른 말은 하지 마라.' }]
const aliveText: string[] = []

for (const m of CANDIDATES) {
  const r = await tryModel(m, textParts)
  console.log(`  ${r.ok ? '✓' : '✗'} ${m.padEnd(28)} ${String(r.ms).padStart(6)}ms  ${r.note}`)
  if (r.ok) aliveText.push(m)
}

/* ------------------------------ 비전 ------------------------------ */

const bands = crop()
console.log('\n■ 비전 (이모티콘·사진 판독용)\n')

const aliveVision: string[] = []
if (!bands) {
  console.log('  조각을 만들지 못했습니다 — OCR 서비스 또는 fixtures 확인')
} else {
  const fd = new FormData()
  const img = readFileSync(join(process.cwd(), 'fixtures', 'real', 'mom_03.png'))
  fd.append('file', new Blob([new Uint8Array(img)], { type: 'image/png' }), 'mom_03.png')
  fd.append('bands', bands)
  const res = await fetch(`${process.env.OCR_SERVICE_URL ?? 'http://127.0.0.1:8756'}/crop`, {
    method: 'POST',
    body: fd,
  })
  const { crops } = (await res.json()) as { crops: Array<{ png_base64: string }> }

  const visionParts = [
    { text: '이 그림에 무엇이 있는지 10자 이내로만 답해라.' },
    { inline_data: { mime_type: 'image/png', data: crops[0].png_base64 } },
  ]

  for (const m of CANDIDATES) {
    const r = await tryModel(m, visionParts)
    console.log(`  ${r.ok ? '✓' : '✗'} ${m.padEnd(28)} ${String(r.ms).padStart(6)}ms  ${r.note}`)
    if (r.ok) aliveVision.push(m)
  }
}

/* ------------------------------ 결론 ------------------------------ */

console.log('\n■ 지금 쓸 수 있는 것')
console.log(`  텍스트: ${aliveText[0] ?? '없음'}${aliveText.length > 1 ? `  (대안 ${aliveText.slice(1).join(', ')})` : ''}`)
console.log(`  비전  : ${aliveVision[0] ?? '없음'}${aliveVision.length > 1 ? `  (대안 ${aliveVision.slice(1).join(', ')})` : ''}`)
console.log('\n.env.local 에 넣으면 코드 수정 없이 바뀝니다:')
if (aliveText[0]) console.log(`  GEMINI_MODEL=${aliveText[0]}`)
if (aliveVision[0] && aliveVision[0] !== aliveText[0]) {
  console.log(`  GEMINI_VISION_MODEL=${aliveVision[0]}`)
}
