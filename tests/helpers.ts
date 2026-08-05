import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildCorpus } from '@/lib/corpus'
import { isUnsupported, parseTxt, resolveWho, toMessages } from '@/lib/parsers/txt'
import type { Corpus, Msg } from '@/lib/types'
import type { SeedName } from '@/lib/seed/generate'
import type { CaptureSeedName } from '@/lib/seed/capture'

export const SEED_DIR = join(process.cwd(), 'fixtures', 'seeds')

export function readSeed(name: SeedName, fmt: 'pc' | 'android'): string {
  return readFileSync(join(SEED_DIR, `${name}.${fmt}.txt`), 'utf8')
}

export function txtCorpus(
  name: SeedName,
  fmt: 'pc' | 'android' = 'pc',
): Corpus {
  const parsed = parseTxt(readSeed(name, fmt))
  if (isUnsupported(parsed)) throw new Error('unsupported format')
  const who = resolveWho(parsed.title, parsed.speakers)
  if (!who.resolved) throw new Error('speaker resolution failed')
  return buildCorpus(toMessages(parsed.raw, who.map), {
    mode: 'txt',
    source: parsed.source,
    deleted: parsed.deleted,
  })
}

export function captureCorpus(name: CaptureSeedName): Corpus {
  const msgs = JSON.parse(
    readFileSync(join(SEED_DIR, `${name}.json`), 'utf8'),
  ) as Msg[]
  // 캡처는 이미지 사이 연결이 끊기므로 스크롤 경계를 기록한다.
  return buildCorpus(msgs, {
    mode: 'capture',
    source: 'unknown',
    gaps: ['scroll_break:img2'],
  })
}
