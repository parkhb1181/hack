/**
 * Vision 2패스 왕복 검증 — `npx tsx scripts/check/affect.ts <이름>`
 *
 * OCR이 찾은 비텍스트 자리를 잘라 Gemini에 보내고, `nontext`를
 * `emoticon`/`photo` + `affect`로 승격시킨다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildCorpus } from '@/lib/corpus'
import { loadEnvLocal } from '@/lib/env'
import { CATALOG } from '@/lib/metrics/catalog'
import { evaluateAll } from '@/lib/metrics/registry'
import { findHoles, groupBubbles, toMessages, type OcrPage } from '@/lib/parsers/ocr'
import { OCR_URL } from '@/lib/parsers/ocr-client'
import { readAffect } from '@/lib/vision/gemini'
import type { Msg } from '@/lib/types'

loadEnvLocal()

const name = process.argv[2] ?? 'mobile_dark_sticker'
const dir = join(process.cwd(), 'fixtures', 'real')

const page = JSON.parse(readFileSync(join(dir, `${name}.ocr.json`), 'utf8')) as OcrPage
const holes = findHoles(page, groupBubbles(page))
const parsed = toMessages(page)

console.log(`${name}: 말풍선 ${parsed.messages.length}개 · 비텍스트 자리 ${holes.length}개`)
if (holes.length === 0) {
  console.log('비텍스트 발화가 없어 2패스를 건너뜁니다.')
  process.exit(0)
}

// 1) 자리마다 조각을 잘라온다 (Python 서비스가 PIL로 처리)
const bytes = readFileSync(join(dir, `${name}.png`))
const form = new FormData()
form.append('file', new Blob([bytes], { type: 'image/png' }), `${name}.png`)
form.append('bands', JSON.stringify(holes.map((h) => h.y)))

const cropRes = await fetch(`${OCR_URL}/crop`, { method: 'POST', body: form })
if (!cropRes.ok) throw new Error(`crop 실패 ${cropRes.status}: ${await cropRes.text()}`)
const { crops } = (await cropRes.json()) as {
  crops: Array<{ y: [number, number]; width: number; height: number; png_base64: string }>
}
console.log(`조각 ${crops.length}장 — ${crops.map((c) => `${c.width}×${c.height}`).join(', ')}`)

// 2) 한 번의 호출로 정서를 읽는다
const started = Date.now()
const results = await readAffect(crops.map((c) => c.png_base64))
console.log(`Gemini ${((Date.now() - started) / 1000).toFixed(1)}초\n`)

results.forEach((r, i) => {
  if (!r) {
    console.log(`  조각 ${i}: 판독 실패 → nontext 유지`)
    return
  }
  console.log(
    `  조각 ${i}: ${r.type}  "${r.emojiDesc}"  valence=${r.affect.valence} intensity=${r.affect.intensity} conf=${r.confidence}`,
  )
})

// 3) nontext 를 승격시킨다
let k = 0
const upgraded: Msg[] = parsed.messages.map((m) => {
  if (m.type !== 'nontext') return m
  const r = results[k++]
  if (!r) return m
  return { ...m, type: r.type, emojiDesc: r.emojiDesc, affect: r.affect, confidence: r.confidence }
})

const before = buildCorpus(parsed.messages, { mode: 'capture' })
const after = buildCorpus(upgraded, { mode: 'capture' })

console.log(`\n정보 단위  ${before.infoUnits} → ${after.infoUnits}`)
console.log(`가용 필드  ${[...after.availableFields].join(', ')}`)

const m = evaluateAll(CATALOG, after)
for (const key of ['emojiAffect', 'emojiVariety']) {
  const r = m[key]
  const detail =
    r.status === 'OK'
      ? JSON.stringify(r.value)
      : r.status === 'LOCKED'
        ? `missing=${r.missing.join(',')}`
        : `${Math.floor(r.have)}/${r.need}`
  console.log(`  ${key.padEnd(13)} ${r.status.padEnd(13)} ${detail}`)
}
