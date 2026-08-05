/**
 * 개발용 점검 출력 — `npx tsx scripts/dev/inspect.ts`
 * 골든 값을 눈으로 확인할 때 쓴다.
 */

import { buildCorpus } from '@/lib/corpus'
import { isUnsupported, parseTxt, resolveWho, toMessages } from '@/lib/parsers/txt'
import { computeHeadline, evidenceBadge } from '@/lib/stats/headline'
import { CATALOG } from '@/lib/metrics/catalog'
import { evaluateAll } from '@/lib/metrics/registry'
import { countSessions } from '@/lib/metrics/temporal'
import { CAPTURE_SEEDS, generateCaptureSeed } from '@/lib/seed/capture'
import { buildReport, isHardFloor } from '@/lib/report'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Corpus } from '@/lib/types'

const DIR = join(process.cwd(), 'fixtures', 'seeds')

function txt(name: string): Corpus {
  const p = parseTxt(readFileSync(join(DIR, `${name}.pc.txt`), 'utf8'))
  if (isUnsupported(p)) throw new Error('unsupported')
  const w = resolveWho(p.title, p.speakers)
  return buildCorpus(toMessages(p.raw, w.map), {
    mode: 'txt',
    source: p.source,
    deleted: p.deleted,
  })
}

function show(label: string, c: Corpus) {
  const h = computeHeadline(c, c.semantic)
  const metrics = evaluateAll(CATALOG, c)
  console.log(`\n=== ${label} ===`)
  console.log(
    `msgs=${c.messages.length} window=${c.windowFilled} infoUnits=${c.infoUnits} fields=${[...c.availableFields].join(',')}`,
  )
  console.log(`tilt=${h.tilt} band=${h.band} axes=${JSON.stringify(h.axes)} used=${h.axesUsed}/${h.axesTotal}`)
  console.log(`badge: ${evidenceBadge(c, c.availableFields.has('continuity') ? countSessions(c) : null)}`)
  for (const [k, r] of Object.entries(metrics)) {
    const detail =
      r.status === 'OK'
        ? JSON.stringify(r.value).slice(0, 110)
        : r.status === 'LOCKED'
          ? `missing=${r.missing.join(',')}`
          : `${r.have}/${r.need}`
    console.log(`  ${k.padEnd(14)} ${r.status.padEnd(13)} ${detail}`)
  }
}

for (const n of ['seed_balanced', 'seed_faded', 'seed_onesided']) show(n, txt(n))

for (const n of CAPTURE_SEEDS) {
  const c = buildCorpus(generateCaptureSeed(n), {
    mode: 'capture',
    gaps: ['scroll_break:img2'],
  })
  show(n, c)
  const r = buildReport(c)
  if (isHardFloor(r)) console.log(`  → HARD FLOOR: ${r.singleFact}`)
}
