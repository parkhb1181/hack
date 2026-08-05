/**
 * 시드 파일 생성 — `npm run seed`
 *
 * fixtures/seeds/ 아래에 txt 시드 3종 × (PC / 안드로이드)를 쓴다.
 * 생성기는 결정론적이므로 재실행해도 파일이 바뀌지 않는다.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  deletedPositions,
  generateSeed,
  renderAndroid,
  renderPC,
  type SeedName,
} from '@/lib/seed/generate'
import { CAPTURE_SEEDS, generateCaptureSeed } from '@/lib/seed/capture'

const OUT = join(process.cwd(), 'fixtures', 'seeds')
mkdirSync(OUT, { recursive: true })

const NAMES: SeedName[] = ['seed_balanced', 'seed_faded', 'seed_onesided']

for (const name of NAMES) {
  const events = generateSeed(name)
  const del = deletedPositions(events)

  const pc = renderPC(events, undefined, del)
  const an = renderAndroid(events, undefined, del)

  writeFileSync(join(OUT, `${name}.pc.txt`), pc, 'utf8')
  writeFileSync(join(OUT, `${name}.android.txt`), an, 'utf8')

  const days = new Set(events.map((e) => new Date(e.ts).toISOString().slice(0, 10)))
  const months = new Set(events.map((e) => new Date(e.ts).toISOString().slice(0, 7)))
  console.log(
    `${name}: ${events.length} msgs · ${days.size} days · ${months.size} months · PC ${pc.length}B · AN ${an.length}B`,
  )
}

for (const name of CAPTURE_SEEDS) {
  const msgs = generateCaptureSeed(name)
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(msgs, null, 2), 'utf8')
  console.log(`${name}: ${msgs.length} msgs (capture)`)
}

console.log(`\nwrote to ${OUT}`)
