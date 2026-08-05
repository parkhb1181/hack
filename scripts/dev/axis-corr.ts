/** 축 상관을 시드별로 / 합쳐서 각각 출력한다 — TESTPLAN §5 진단용 */

import { buildCorpus, mean, stdev } from '@/lib/corpus'
import { axisMsgCount, axisMsgLength, axisQuestion } from '@/lib/stats/headline'
import { WINDOW_SIZE } from '@/lib/types'
import { isUnsupported, parseTxt, resolveWho, toMessages } from '@/lib/parsers/txt'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SEEDS = ['seed_balanced', 'seed_faded', 'seed_onesided']
const STRIDE = 40

function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs), my = mean(ys)
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i] - mx, b = ys[i] - my
    num += a * b; dx += a * a; dy += b * b
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy)
}

function corpusOf(name: string) {
  const p = parseTxt(
    readFileSync(join(process.cwd(), 'fixtures', 'seeds', `${name}.pc.txt`), 'utf8'),
  )
  if (isUnsupported(p)) throw new Error('unsupported')
  const w = resolveWho(p.title, p.speakers)
  return buildCorpus(toMessages(p.raw, w.map), { mode: 'txt' })
}

function windows(name: string) {
  const msgs = corpusOf(name).messages
  const cols: Record<string, number[]> = { msgCount: [], msgLength: [], question: [] }
  for (let s = 0; s + WINDOW_SIZE <= msgs.length; s += STRIDE) {
    const c = buildCorpus(msgs.slice(s, s + WINDOW_SIZE), { mode: 'txt' })
    const a = axisMsgCount(c.window), b = axisMsgLength(c.window), q = axisQuestion(c.window)
    if (a == null || b == null || q == null) continue
    cols.msgCount.push(a); cols.msgLength.push(b); cols.question.push(q)
  }
  return cols
}

function report(label: string, cols: Record<string, number[]>) {
  const k = Object.keys(cols)
  console.log(`\n${label}  (창 ${cols.msgCount.length}개)`)
  for (let i = 0; i < k.length; i++)
    for (let j = i + 1; j < k.length; j++)
      console.log(`  r(${k[i]}, ${k[j]}) = ${pearson(cols[k[i]], cols[k[j]]).toFixed(3)}`)
  for (const key of k)
    console.log(`  stdev(${key}) = ${stdev(cols[key]).toFixed(4)}  mean = ${mean(cols[key]).toFixed(3)}`)
}

const pooled: Record<string, number[]> = { msgCount: [], msgLength: [], question: [] }
for (const s of SEEDS) {
  const cols = windows(s)
  report(s, cols)
  for (const k of Object.keys(pooled)) pooled[k].push(...cols[k])
}
report('POOLED (TESTPLAN §5가 지정한 방식)', pooled)
