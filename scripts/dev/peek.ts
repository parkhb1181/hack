/**
 * 실물 대화 파일 구조 훑어보기 — `npx tsx scripts/dev/peek.ts <경로>`
 *
 * **본문은 절대 찍지 않는다.** 이름도 첫 글자만 남긴다 — 로그가 유출 경로가
 * 되면 안 된다. 여기서 보는 것은 구조뿐이다: 형식, 화자 분포, 기간, 결측.
 */

import { readFileSync } from 'node:fs'

import { isCsvFailure, parseCsv } from '@/lib/parsers/csv'
import { isUnsupported, parseTxt, type ParseResult } from '@/lib/parsers/txt'

const path = process.argv[2]
if (!path) {
  console.error('사용: npx tsx scripts/dev/peek.ts <파일 경로>')
  process.exit(1)
}

const body = readFileSync(path, 'utf8')
const isCsv = /\.csv$/i.test(path)

let p: ParseResult
if (isCsv) {
  const r = parseCsv(body)
  if (isCsvFailure(r)) {
    console.log(`CSV 읽기 실패 — ${r.detail}`)
    process.exit(1)
  }
  p = r
} else {
  const r = parseTxt(body)
  if (isUnsupported(r)) {
    console.log(`형식 미지원: ${r.unsupported} (iOS는 CSV로 내보내야 합니다)`)
    process.exit(1)
  }
  p = r
}

const mask = (s: string) => s[0] + '●'.repeat(Math.max(0, [...s].length - 1))

console.log(`형식 ${p.source} · 제목줄 ${p.title ? '있음' : '없음'}`)
console.log(`메시지 ${p.raw.length} · 화자 ${p.speakers.length}명`)
console.log(`삭제 ${p.deleted} · 시스템 ${p.system} · 못 읽음 ${p.unparsed} · 멀티라인 ${p.multiline}`)
console.log(`기간 ${p.raw[0]?.date} ~ ${p.raw[p.raw.length - 1]?.date}`)

console.log('\n상위 화자 (이름은 가림)')
const top = p.speakers.slice(0, 15)
for (const s of top) {
  const share = ((s.count / p.raw.length) * 100).toFixed(1)
  console.log(
    `  ${mask(s.name).padEnd(12)} ${String(s.count).padStart(6)}건 ${share.padStart(5)}%  ${s.firstDate} ~ ${s.lastDate}`,
  )
}
const rest = p.speakers.slice(15)
if (rest.length) {
  console.log(`  나머지 ${rest.length}명 · ${rest.reduce((n, s) => n + s.count, 0)}건`)
}
