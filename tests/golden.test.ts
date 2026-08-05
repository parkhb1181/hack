/**
 * 골든 테스트 — TESTPLAN.md §3.1, §3.2
 *
 * 축이나 공식이 바뀌면 골든을 갱신하고 **커밋 메시지에 이유를 남긴다.**
 * 갱신: `GOLDEN_UPDATE=1 npx vitest run tests/golden.test.ts`
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { bursts, sessions } from '@/lib/corpus'
import { isUnsupported, parseTxt, resolveWho } from '@/lib/parsers/txt'
import { computeHeadline } from '@/lib/stats/headline'
import { CATALOG } from '@/lib/metrics/catalog'
import { evaluateAll } from '@/lib/metrics/registry'
import { captureCorpus, readSeed, txtCorpus } from './helpers'
import type { SeedName } from '@/lib/seed/generate'
import { CAPTURE_SEEDS } from '@/lib/seed/capture'

const GOLDEN_DIR = join(process.cwd(), 'fixtures', 'golden')
const UPDATE = process.env.GOLDEN_UPDATE === '1'

const SEEDS: SeedName[] = ['seed_balanced', 'seed_faded', 'seed_onesided']

function golden(name: string, actual: unknown) {
  mkdirSync(GOLDEN_DIR, { recursive: true })
  const path = join(GOLDEN_DIR, `${name}.json`)
  const text = JSON.stringify(actual, null, 2)

  if (UPDATE || !existsSync(path)) {
    writeFileSync(path, text, 'utf8')
    return
  }
  expect(JSON.parse(text)).toEqual(JSON.parse(readFileSync(path, 'utf8')))
}

describe.each(SEEDS)('%s — 파서 골든', (name) => {
  it('회귀 비교', () => {
    const parsed = parseTxt(readSeed(name, 'pc'))
    if (isUnsupported(parsed)) throw new Error('unsupported')
    const c = txtCorpus(name)
    const who = resolveWho(parsed.title, parsed.speakers)
    expect(who.resolved).toBe(true)

    const bs = bursts(c.messages)
    const snapshot = {
      totalMessages: c.messages.length,
      byWho: {
        me: c.messages.filter((m) => m.who === 'me').length,
        other: c.messages.filter((m) => m.who === 'other').length,
      },
      sessions: sessions(c.messages).length,
      bursts: {
        me: bs.filter((b) => b.who === 'me').length,
        other: bs.filter((b) => b.who === 'other').length,
      },
      media: {
        photo: c.messages.filter((m) => m.type === 'photo').length,
        emoticon: c.messages.filter((m) => m.type === 'emoticon').length,
        deleted: c.counters.deleted,
      },
      multiline: parsed.multiline,
      midnightMessages: parsed.midnight,
      unparsedRecords: parsed.unparsed,
      infoUnits: c.infoUnits,
    }

    // 파서가 조용히 버리는 레코드가 생기면 모든 지표가 틀어진다
    expect(snapshot.unparsedRecords).toBe(0)
    // 버스트는 정의상 화자가 교대하므로 두 사람의 차이가 1을 넘을 수 없다
    expect(Math.abs(snapshot.bursts.me - snapshot.bursts.other)).toBeLessThanOrEqual(1)

    golden(`parser.${name}`, snapshot)
  })
})

describe.each(SEEDS)('%s — 지표 골든', (name) => {
  it('회귀 비교', () => {
    const c = txtCorpus(name)
    const h = computeHeadline(c, null)
    golden(`headline.${name}`, {
      axes: h.axes,
      tilt: h.tilt,
      band: h.band,
      axesUsed: h.axesUsed,
      axesTotal: h.axesTotal,
      precisionReduced: h.precisionReduced,
    })
  })

  it('지표 상태 계약 회귀 비교', () => {
    const c = txtCorpus(name)
    const m = evaluateAll(CATALOG, c)
    const statuses = Object.fromEntries(
      Object.entries(m).map(([k, v]) => [
        k,
        v.status === 'LOCKED'
          ? `LOCKED:${v.missing.join('|')}`
          : v.status === 'INSUFFICIENT'
            ? `INSUFFICIENT:${Math.floor(v.have)}/${v.need}`
            : 'OK',
      ]),
    )
    golden(`status.${name}`, statuses)
  })
})

describe.each(CAPTURE_SEEDS)('%s — 캡처 골든', (name) => {
  it('회귀 비교', () => {
    const c = captureCorpus(name)
    const h = computeHeadline(c, null)
    golden(`capture.${name}`, {
      messages: c.messages.length,
      infoUnits: c.infoUnits,
      windowFilled: c.windowFilled,
      fields: [...c.availableFields].sort(),
      axes: h.axes,
      tilt: h.tilt,
      band: h.band,
    })
  })
})
