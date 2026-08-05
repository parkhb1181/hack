/**
 * 임베딩 실측 — `npx tsx scripts/bench/embed.ts`
 *
 * 판독 창 120개(= 실제 운영에서 임베딩에 보내는 전량)로 속도를 재고,
 * SPEC §10의 동조율·분리도가 실제로 의미 있는 값을 내는지 확인한다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildCorpus } from '@/lib/corpus'
import { isUnsupported, parseTxt, resolveWho, toMessages } from '@/lib/parsers/txt'
import { computeHeadline } from '@/lib/stats/headline'
import {
  computeSemantic,
  computeSync,
  embedTargets,
  type VecMap,
} from '@/lib/semantic/metrics'
import { EMBED_MODEL, clearEmbedCache, embedTexts } from '@/lib/semantic/ollama'
import { generateCaptureSeed, type CaptureSeedName } from '@/lib/seed/capture'
import type { Corpus, Msg } from '@/lib/types'

const DIR = join(process.cwd(), 'fixtures', 'seeds')

function txtCorpus(name: string): Corpus {
  const p = parseTxt(readFileSync(join(DIR, `${name}.pc.txt`), 'utf8'))
  if (isUnsupported(p)) throw new Error('unsupported')
  const w = resolveWho(p.title, p.speakers)
  return buildCorpus(toMessages(p.raw, w.map), { mode: 'txt', source: p.source })
}

async function run(label: string, c: Corpus) {
  // 임베딩 대상 = 판독 창 안에서 2글자 이하 반응을 뺀 것 (SPEC §10.1)
  const targets: Msg[] = embedTargets(c.window)
  const texts = targets.map((m) => m.text as string)

  clearEmbedCache()
  const { vectors, stats } = await embedTexts(texts)

  const vecs: VecMap = new Map()
  targets.forEach((m, i) => vecs.set(m.seq, vectors[i]))

  const semantic = computeSemantic(c.window, vecs)

  // 임베딩을 켠 코퍼스로 4축 헤드라인을 다시 계산
  const withEmb = buildCorpus(c.messages, {
    mode: c.mode,
    embedding: true,
    semantic,
    gaps: c.gaps,
  })
  const h3 = computeHeadline(c, null)
  const h4 = computeHeadline(withEmb, semantic)

  const uniq = new Set(texts).size
  console.log(`\n=== ${label} ===`)
  console.log(
    `창 ${c.window.length}개 → 임베딩 대상 ${texts.length}개 (고유 ${uniq}개, 2글자 이하 ${c.window.filter((m) => m.type === 'text').length - texts.length}개 제외)`,
  )
  console.log(
    `임베딩 ${stats.ms}ms · ${(stats.count / (stats.ms / 1000)).toFixed(0)}문장/초 · ${stats.dim}차원`,
  )
  const sync = computeSync(c.window, vecs)
  console.log(
    `동조율  원값 나=${sync.raw.me} 상대=${sync.raw.other}  |  기준선 나=${sync.baseline.me} 상대=${sync.baseline.other}`,
  )
  console.log(
    `        감산후 나=${semantic.syncMe} 상대=${semantic.syncOther} (전환 쌍 ${semantic.pairs}개)`,
  )
  console.log(
    `분리도  ${semantic.styleSep} · 벡터 나=${semantic.vectors.me} 상대=${semantic.vectors.other}`,
  )
  console.log(
    `기울기  3축 ${h3.tilt} (${h3.band})  →  4축 ${h4.tilt} (${h4.band})  · I_동조=${h4.axes.sync ?? '-'}`,
  )
}

async function main() {
  console.log(`model: ${EMBED_MODEL}`)

  for (const n of ['seed_balanced', 'seed_faded', 'seed_onesided']) {
    await run(n, txtCorpus(n))
  }

  for (const n of ['cap_balanced', 'cap_onesided_me'] as CaptureSeedName[]) {
    await run(
      n,
      buildCorpus(generateCaptureSeed(n), { mode: 'capture', gaps: ['scroll_break:img2'] }),
    )
  }

  // 캐시 효과 — 같은 세트 재실행
  const c = txtCorpus('seed_balanced')
  const texts = embedTargets(c.window).map((m) => m.text as string)
  clearEmbedCache()
  const cold = await embedTexts(texts)
  const warm = await embedTexts(texts)
  console.log(
    `\n캐시: 콜드 ${cold.stats.ms}ms → 웜 ${warm.stats.ms}ms (히트 ${warm.stats.cacheHits}/${warm.stats.count})`,
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
