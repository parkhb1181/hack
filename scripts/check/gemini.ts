/**
 * Gemini 키 유효성 + 사용 가능 모델 확인 — `npx tsx scripts/check/gemini.ts`
 *
 * 키 형식이 두 가지라 둘 다 시도한다:
 *   - `AIza...`  → 쿼리 파라미터 `?key=`
 *   - 그 외      → OAuth 액세스 토큰으로 보고 `Authorization: Bearer`
 */

import { readFileSync } from 'node:fs'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

function loadKey(): string {
  // PowerShell의 -Encoding UTF8은 BOM을 붙인다. 벗기지 않으면 첫 줄이 안 잡힌다.
  const env = readFileSync('.env.local', 'utf8').replace(/^﻿/, '')
  const m = /^\s*GEMINI_API_KEY\s*=\s*(.+)$/m.exec(env)
  if (!m) throw new Error('.env.local 에 GEMINI_API_KEY 가 없습니다')
  return m[1].trim()
}

const key = loadKey()
const looksLikeApiKey = key.startsWith('AIza')
console.log(`키 형식: ${looksLikeApiKey ? 'API 키 (AIza…)' : 'OAuth 토큰으로 추정'} · 길이 ${key.length}\n`)

type Attempt = { label: string; url: string; headers: Record<string, string> }

const attempts: Attempt[] = [
  { label: '?key= 쿼리', url: `${BASE}/models?key=${encodeURIComponent(key)}`, headers: {} },
  { label: 'Bearer 헤더', url: `${BASE}/models`, headers: { Authorization: `Bearer ${key}` } },
]

for (const a of attempts) {
  try {
    const res = await fetch(a.url, { headers: a.headers })
    const body = await res.text()
    if (!res.ok) {
      const short = body.replace(/\s+/g, ' ').slice(0, 200)
      console.log(`✗ ${a.label}  ${res.status}  ${short}\n`)
      continue
    }
    const json = JSON.parse(body) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> }
    const usable = (json.models ?? []).filter((m) =>
      m.supportedGenerationMethods?.includes('generateContent'),
    )
    console.log(`✓ ${a.label}  ${res.status}  모델 ${usable.length}개`)
    for (const m of usable.slice(0, 15)) console.log(`    ${m.name.replace('models/', '')}`)
    break
  } catch (e) {
    console.log(`✗ ${a.label}  ${e instanceof Error ? e.message : String(e)}\n`)
  }
}
