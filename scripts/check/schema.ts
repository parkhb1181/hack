/**
 * 공통 포맷 도달 상태 점검 — `npx tsx scripts/check/schema.ts`
 *
 * 두 다리(txt / 캡처)가 같은 `Msg[]`로 수렴하는지, 수렴한 뒤 필드 가용성이
 * 의도대로 갈리는지 본다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildCorpus } from '@/lib/corpus'
import { toMessages as ocrToMessages, type OcrPage } from '@/lib/parsers/ocr'
import { isUnsupported, parseTxt, resolveWho, toMessages as txtToMessages } from '@/lib/parsers/txt'
import type { Msg } from '@/lib/types'

function dist(msgs: Msg[]): string {
  const t: Record<string, number> = {}
  for (const m of msgs) t[m.type] = (t[m.type] ?? 0) + 1
  return Object.entries(t)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
}

function filled(msgs: Msg[], key: keyof Msg): string {
  const n = msgs.filter((m) => m[key] != null).length
  return `${n}/${msgs.length}`
}

console.log('다리 1 — txt → 파서 → Msg[]')
for (const name of ['seed_balanced', 'seed_onesided']) {
  const p = parseTxt(readFileSync(join('fixtures/seeds', `${name}.pc.txt`), 'utf8'))
  if (isUnsupported(p)) continue
  const w = resolveWho(p.title, p.speakers)
  const msgs = txtToMessages(p.raw, w.map)
  const c = buildCorpus(msgs, { mode: 'txt', deleted: p.deleted })
  console.log(`  ${name.padEnd(16)} ${msgs.length}개  [${dist(msgs)}]`)
  console.log(`  ${' '.repeat(16)} ts=${filled(msgs, 'ts')} date=${filled(msgs, 'date')} time=${filled(msgs, 'time')} affect=${filled(msgs, 'affect')}`)
  console.log(`  ${' '.repeat(16)} 필드: ${[...c.availableFields].join(', ')}`)
}

console.log('\n다리 2 — 캡처 → OCR → Msg[]')
for (const name of ['pc_dark_01', 'mobile_dark_sticker']) {
  const page = JSON.parse(
    readFileSync(join('fixtures/real', `${name}.ocr.json`), 'utf8'),
  ) as OcrPage
  const r = ocrToMessages(page)
  const c = buildCorpus(r.messages, { mode: 'capture', gaps: r.gaps })
  console.log(`  ${name.padEnd(22)} ${r.messages.length}개  [${dist(r.messages)}]`)
  console.log(`  ${' '.repeat(22)} ts=${filled(r.messages, 'ts')} date=${filled(r.messages, 'date')} time=${filled(r.messages, 'time')} affect=${filled(r.messages, 'affect')}`)
  console.log(`  ${' '.repeat(22)} 필드: ${[...c.availableFields].join(', ')}`)
  console.log(`  ${' '.repeat(22)} gaps: ${r.gaps.length ? r.gaps.join(', ') : '없음'}`)
}
