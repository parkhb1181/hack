/**
 * 비전 모델 가용성 — `npx tsx scripts/check/vision-model.ts`
 *
 * 실측에서 `gemini-3.6-flash`가 403 PERMISSION_DENIED로 막혔다. 조각 하나를
 * 실제로 태워 어느 모델이 지금 살아 있는지 본다.
 */

import { loadEnvLocal } from '@/lib/env'
loadEnvLocal()

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { AFFECT_PROMPT } from '@/lib/vision/gemini'
import { findHoles, groupBubbles, type OcrPage } from '@/lib/parsers/ocr'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const KEY = process.env.GEMINI_API_KEY ?? ''

// 실제 파이프라인이 만드는 조각을 그대로 쓴다
const page = JSON.parse(
  readFileSync(join(process.cwd(), 'fixtures', 'real', 'mom_03.ocr.json'), 'utf8'),
) as OcrPage
const holes = findHoles(page, groupBubbles(page))
if (holes.length === 0) throw new Error('구간이 없습니다')

const img = readFileSync(join(process.cwd(), 'fixtures', 'real', 'mom_03.png'))
const fd = new FormData()
fd.append('file', new Blob([new Uint8Array(img)], { type: 'image/png' }), 'mom_03.png')
fd.append('bands', JSON.stringify([holes[0].y]))
const cropRes = await fetch(`${process.env.OCR_SERVICE_URL ?? 'http://127.0.0.1:8756'}/crop`, {
  method: 'POST',
  body: fd,
})
const { crops } = (await cropRes.json()) as { crops: Array<{ png_base64: string }> }
console.log(`조각 1개 준비 (y ${holes[0].y[0]}~${holes[0].y[1]})\n`)

const MODELS = [
  'gemini-3.6-flash',
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
  'gemini-2.0-flash',
]

for (const model of MODELS) {
  const t0 = Date.now()
  try {
    const res = await fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(KEY)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: AFFECT_PROMPT },
              { text: '조각 0' },
              { inline_data: { mime_type: 'image/png', data: crops[0].png_base64 } },
            ],
          },
        ],
      }),
    })
    const body = await res.text()
    if (!res.ok) {
      const m = /"message":\s*"([^"]{0,90})/.exec(body)
      console.log(`✗ ${model.padEnd(26)} ${res.status}  ${m?.[1] ?? ''}`)
      continue
    }
    const json = JSON.parse(body) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    console.log(`✓ ${model.padEnd(26)} ${Date.now() - t0}ms  ${text.replace(/\s+/g, ' ').slice(0, 110)}`)
  } catch (e) {
    console.log(`✗ ${model.padEnd(26)} ${e instanceof Error ? e.message : String(e)}`)
  }
}
