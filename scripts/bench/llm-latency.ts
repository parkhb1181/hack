/**
 * LLM 지연 실측 — `npx tsx scripts/bench/llm-latency.ts`
 *
 * 실측에서 12초 타임아웃에 2/3이 걸렸다. gemini-3.6-flash는 사고(thinking)
 * 모델이라 기본값이면 느리다. 사고를 끄면 얼마나 줄어드는지 본다.
 */

import { loadEnvLocal } from '@/lib/env'
loadEnvLocal()

import { buildCorpus } from '@/lib/corpus'
import { buildMetricBlock, SYSTEM_PROMPT, STAGE_LINE } from '@/lib/llm/interpret'
import { isUnsupported, parseTxt, resolveWho, toMessages } from '@/lib/parsers/txt'
import { buildReport, isHardFloor } from '@/lib/report'
import type { Report } from '@/lib/types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const KEY = process.env.GEMINI_API_KEY ?? ''

const raw = readFileSync(join(process.cwd(), 'fixtures', 'seeds', 'seed_onesided.pc.txt'), 'utf8')
const parsed = parseTxt(raw)
if (isUnsupported(parsed)) throw new Error('형식 미지원')
const who = resolveWho(parsed.title, parsed.speakers)
const corpus = buildCorpus(toMessages(parsed.raw, who.map), {
  mode: 'txt',
  source: parsed.source,
  deleted: parsed.deleted,
})
const report = buildReport(corpus)
if (isHardFloor(report)) throw new Error('하드 플로어')
const block = buildMetricBlock(report as Report, 'crush')

type Variant = { label: string; model: string; cfg?: Record<string, unknown> }
const VARIANTS: Variant[] = [
  { label: 'flash / 기본', model: 'gemini-3.6-flash' },
  { label: 'flash / level low', model: 'gemini-3.6-flash', cfg: { thinkingLevel: 'low' } },
  { label: 'flash / thinking low', model: 'gemini-3.6-flash', cfg: { thinkingConfig: { thinkingLevel: 'low' } } },
  { label: 'flash-lite / 기본', model: 'gemini-flash-lite-latest' },
  { label: '2.0-flash / 기본', model: 'gemini-2.0-flash' },
]

const RUNS = 3

for (const v of VARIANTS) {
  const times: number[] = []
  let fail = ''
  for (let i = 0; i < RUNS; i++) {
    const t0 = Date.now()
    try {
      const res = await fetch(
        `${BASE}/models/${v.model}:generateContent?key=${encodeURIComponent(KEY)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: AbortSignal.timeout(60_000),
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\n\n${STAGE_LINE.crush}` }] },
            contents: [{ role: 'user', parts: [{ text: block }] }],
            ...(v.cfg ? { generationConfig: v.cfg } : {}),
          }),
        },
      )
      if (!res.ok) {
        fail = `${res.status} ${(await res.text()).replace(/\s+/g, ' ').slice(0, 120)}`
        break
      }
      await res.json()
      times.push(Date.now() - t0)
    } catch (e) {
      fail = e instanceof Error ? e.message : String(e)
      break
    }
  }
  if (fail) {
    console.log(`✗ ${v.label.padEnd(22)} ${fail}`)
    continue
  }
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length)
  console.log(`  ${v.label.padEnd(22)} 평균 ${avg}ms   ${times.map((t) => `${t}`).join(' / ')}`)
}

