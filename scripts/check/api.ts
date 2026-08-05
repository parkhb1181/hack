/**
 * `/api/analyze` 실측 — `npx tsx scripts/check/api.ts <이름...>`
 *
 * 화면과 **같은 경로**로 돌린다. 스크립트에서만 되고 화면에서 안 되는 상황을
 * 만들지 않기 위해서다.
 *
 * 원문은 찍지 않는다 — 실물 대화로 돌리므로 로그가 유출 경로가 되면 안 된다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { HardFloor, Report } from '@/lib/types'
import type { Trace } from '@/lib/trace'
import { HARD_FLOOR } from '@/lib/stats/sample'

const BASE = process.env.APP_URL ?? 'http://localhost:3000'
const names = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const stage = process.argv.includes('--couple') ? 'couple' : 'family'
if (names.length === 0) {
  console.error('사용: npx tsx scripts/check/api.ts mom_01 mom_02 mom_03')
  process.exit(1)
}

const fd = new FormData()
// 확장자가 붙어 있으면 대화 파일로 본다 — 화면과 같은 갈림길이다
const asText = names.find((n) => /\.(txt|csv)$/i.test(n))
if (asText) {
  const p = asText.includes('/') || asText.includes('\\')
    ? asText
    : join(process.cwd(), 'fixtures', 'real', asText)
  fd.append('file', new Blob([readFileSync(p)], { type: 'text/plain' }), asText.split(/[\\/]/).pop())
} else {
  for (const n of names) {
    const buf = readFileSync(join(process.cwd(), 'fixtures', 'real', `${n}.png`))
    fd.append('images', new Blob([new Uint8Array(buf)], { type: 'image/png' }), `${n}.png`)
  }
}
const meArg = process.argv.find((a) => a.startsWith('--me='))
if (meArg) fd.append('me', meArg.slice(5))
fd.append('stage', stage)

const t0 = Date.now()
const res = await fetch(`${BASE}/api/analyze`, { method: 'POST', body: fd })
const body = (await res.json()) as
  | { report: Report | HardFloor; trace: Trace; hardFloor: boolean }
  | { error: string }

if ('error' in body) {
  console.log(`✗ ${res.status} — ${body.error}`)
  const b = body as { speakers?: Array<{ name: string; count: number }> }
  if (b.speakers) {
    console.log('  화자: ' + b.speakers.map((s) => `${s.name}(${s.count})`).join(' / '))
    console.log('  → --me=<이름> 으로 다시 실행하세요')
  }
  process.exit(1)
}

const { report, trace, hardFloor } = body
console.log(`왕복 ${Date.now() - t0}ms · 단계별 ${JSON.stringify(trace.timings)}\n`)

if (trace.text) {
  const t = trace.text
  console.log(
    `${t.label}  ${t.kind.toUpperCase()} · ${t.source} · ${(t.bytes / 1024).toFixed(1)}KB\n` +
      `      메시지 ${t.records} · 삭제 ${t.deleted} · 시스템 ${t.system} · 못 읽음 ${t.unparsed}\n` +
      `      화자 ${t.speakers.map((s) => `${s.name}(${s.count})`).join(' / ')}\n` +
      `      본인 판정 ${t.resolvedBy ?? '미확정'}`,
  )
}

for (const p of trace.pages) {
  const drops = p.filters.reduce((n, f) => n + f.dropped.length, 0)
  console.log(
    `${p.label.padEnd(12)} ${p.width}×${p.height} · OCR ${p.rawLines.length}줄 → 필터 −${drops} · ` +
      `말풍선 ${p.bubbles.length} · 비텍스트 ${p.holes.length} · 화자 ${p.speakers}` +
      (p.rejected ? ` · 거절(${p.rejected})` : ''),
  )
}

console.log(
  `\n병합  ${trace.merge?.before} → ${trace.merge?.after} (중복 −${trace.merge?.removed})`,
)
console.log(
  `코퍼스 판독창 ${trace.corpus.windowFilled} · 정보단위 ${trace.corpus.infoUnits} · 필드 ${trace.corpus.availableFields.join(',')}`,
)

if (trace.vision) {
  const v = trace.vision
  console.log(
    `\n비전  조각 ${v.crops.length}개 · 구간 안 글자 ${v.enclosedTextLines}줄 ${v.enclosedTextLines === 0 ? '✓' : '⚠ 유출'}` +
      (v.error ? ` · 오류: ${v.error}` : ` · 판독 ${v.items.filter(Boolean).length}건`),
  )
  for (const c of v.crops) console.log(`      ${c.page} y${c.y[0]}~${c.y[1]} ${c.width}×${c.height}`)
  for (const it of v.items) {
    const a = it as { type?: string; emojiDesc?: string; affect?: { valence: number }; confidence?: number } | null
    if (a) console.log(`      → ${a.type} "${a.emojiDesc}" valence ${a.affect?.valence} conf ${a.confidence}`)
  }
}

if (trace.semantic) {
  const s = trace.semantic
  if (s.error) {
    console.log(`\n임베딩 ✗ ${s.error}`)
  } else {
    console.log(`\n임베딩 ${s.model} · ${s.embedded}건(건너뜀 ${s.skipped}) · 전환 쌍 ${s.pairs} · ${s.elapsedMs}ms`)
    console.log(`      코사인 원값   나 ${s.raw?.me} / 상대 ${s.raw?.other}   ← 0~1.0, 이것만 보면 안 된다`)
    console.log(`      무작위 기준선 나 ${s.baseline?.me} / 상대 ${s.baseline?.other}`)
    console.log(`      감산 후(지표) 나 ${s.net?.me} / 상대 ${s.net?.other}   → 동조 축 ${s.axis}`)
    console.log(`      말투 분리도   ${s.styleSep}`)
  }
}

if (hardFloor) {
  const f = report as HardFloor
  console.log(`\n■ 하드 플로어 — 정보 단위 ${f.infoUnits} < ${HARD_FLOOR}`)
  if (f.singleFact) console.log(`  → ${f.singleFact}`)
} else {
  const r = report as Report
  console.log(`\n■ 기울기 ${r.headline.tilt} · ${r.headline.band} · ${r.headline.axesUsed}/${r.headline.axesTotal}축`)
  const ok = Object.entries(r.metrics).filter(([, m]) => m.status === 'OK')
  console.log(`  지표 OK ${ok.length}/${Object.keys(r.metrics).length}`)
}

const odds = (body as { odds?: Array<{ label: string; percent: number; used: number; total: number; coarse: boolean; parts: Array<{ label: string; value: number; weight: number; from: string }> }> }).odds
if (odds) {
  for (const o of odds) {
    console.log(`\n■ ${o.label}  ${o.percent}/100  (축 ${o.used}/${o.total}${o.coarse ? ' · 5단위' : ''})`)
    for (const p of o.parts) {
      console.log(`      ${p.label.padEnd(16)} ${String(Math.round(p.value * 100)).padStart(3)} ×${p.weight}   ${p.from}`)
    }
  }
}

if (trace.llm) {
  const l = trace.llm
  const v = l.verify as { ok?: boolean; badNumbers?: string[]; sentences?: number } | null
  console.log(`\nLLM   ${l.source === 'llm' ? '✓ 채택' : '✗ 폴백'} ${l.elapsedMs}ms${l.reason ? ` — ${l.reason}` : ''}`)
  console.log(`      검증 ${v?.ok ? '통과' : '실패'} · 없는 숫자 ${v?.badNumbers?.join(',') || '없음'} · ${v?.sentences}문장`)
  console.log(`      ${l.text}`)
  console.log(`\n집계 블록에 원문이 있는가: ${/[가-힣]{4,}\s[가-힣]{2,}/.test(l.block.replace(/^#.*$/gm, '')) ? '⚠ 확인 필요' : '없음 ✓'}`)
}


