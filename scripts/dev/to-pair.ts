/**
 * 단톡 → 1:1 추출 — `npx tsx scripts/dev/to-pair.ts <원본> [--rank=1,2] [--out=이름]`
 *
 * 단톡에서 **두 사람의 발화만 남겨** 카카오톡 PC 내보내기 형식으로 다시 쓴다.
 * 테스트용이다 — 실제로 둘만 나눈 대화가 아니므로 지표를 관계 해석에 쓰면 안 된다.
 * 구조(선톡·응답 지연·분량 비대칭)를 큰 표본으로 돌려보는 용도다.
 *
 * ⚠️ 실물 대화이므로 결과는 `fixtures/real/`에 쓴다 — gitignore 대상이다.
 * 콘솔에는 본문을 찍지 않고 이름은 첫 글자만 남긴다.
 *
 * 제목 줄을 `{상대} 님과 카카오톡 대화`로 다시 쓴다. 그래야 `resolveWho`가
 * 제목에서 상대를 특정하고 나머지 한 명을 '나'로 잡는다(§3.10).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { isUnsupported, parseTxt } from '@/lib/parsers/txt'

const path = process.argv[2]
if (!path) {
  console.error('사용: npx tsx scripts/dev/to-pair.ts <원본> [--rank=1,2] [--out=이름]')
  process.exit(1)
}

const rankArg = process.argv.find((a) => a.startsWith('--rank='))?.slice(7) ?? '1,2'
const [rA, rB] = rankArg.split(',').map((n) => parseInt(n, 10))
const outName = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'pair'

const parsed = parseTxt(readFileSync(path, 'utf8'))
if (isUnsupported(parsed)) {
  console.error(`형식 미지원: ${parsed.unsupported}`)
  process.exit(1)
}

const A = parsed.speakers[rA - 1]
const B = parsed.speakers[rB - 1]
if (!A || !B) {
  console.error(`화자 ${rA}위 또는 ${rB}위가 없습니다 (총 ${parsed.speakers.length}명)`)
  process.exit(1)
}

const keep = new Set([A.name, B.name])
const rows = parsed.raw.filter((r) => keep.has(r.name))

/* ── PC 형식으로 다시 쓴다 ────────────────────────────────────── */

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const pad = (n: number) => String(n).padStart(2, '0')

function ampm(time: string): string {
  const [hh, mm] = time.split(':').map(Number)
  const period = hh < 12 ? '오전' : '오후'
  const h12 = hh % 12 === 0 ? 12 : hh % 12
  return `${period} ${h12}:${pad(mm)}`
}

// 본문은 파서가 되돌린 형태로 다시 쓴다. 미디어는 원래 플레이스홀더로 복원한다 —
// 그래야 `classifyBody`가 같은 타입으로 다시 읽는다.
function body(r: (typeof rows)[number]): string {
  switch (r.type) {
    case 'text':
      return r.text ?? ''
    case 'photo':
      return '사진'
    case 'emoticon':
      return '이모티콘'
    case 'voice':
      return '음성메시지'
    case 'file':
      return '파일: 첨부'
    default:
      return r.text ?? ''
  }
}

// B(2위)를 '상대'로 두고 제목에 넣는다 → A가 '나'가 된다
const out: string[] = [`${B.name} 님과 카카오톡 대화`, `저장한 날짜 : ${rows[0]?.date ?? ''} 00:00:00`, '']

let curDate = ''
for (const r of rows) {
  if (r.date !== curDate) {
    curDate = r.date
    const [y, m, d] = r.date.split('-').map(Number)
    const dow = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
    out.push(`--------------- ${y}년 ${m}월 ${d}일 ${dow}요일 ---------------`)
  }
  out.push(`[${r.name}] [${ampm(r.time)}] ${body(r)}`)
}

// 레코드 구분자는 CRLF. 메시지 안의 줄바꿈만 LF로 남는다 — `splitRecords` 참고
const dest = join(process.cwd(), 'fixtures', 'real', `${outName}.txt`)
writeFileSync(dest, out.join('\r\n'), 'utf8')

/* ── 되읽어서 확인한다 — 쓴 게 다시 읽히는지 ─────────────────── */

const back = parseTxt(readFileSync(dest, 'utf8'))
const mask = (s: string) => s[0] + '●'.repeat(Math.max(0, [...s].length - 1))

console.log(`원본: 화자 ${parsed.speakers.length}명 · 메시지 ${parsed.raw.length}`)
console.log(`추출: ${mask(A.name)}(${A.count}) + ${mask(B.name)}(${B.count}) → ${rows.length}건`)
console.log(`기간: ${rows[0]?.date} ~ ${rows[rows.length - 1]?.date}`)
console.log(`파일: ${dest}`)

if (isUnsupported(back)) {
  console.log('\n⚠ 되읽기 실패 — 형식이 깨졌습니다')
  process.exit(1)
}
console.log(
  `\n되읽기: ${back.source} · 메시지 ${back.raw.length} · 화자 ${back.speakers.length}명 · 못 읽음 ${back.unparsed}`,
)
console.log(`제목에서 상대 특정: ${back.title ? mask(back.title) : '실패'}`)
if (back.raw.length !== rows.length) {
  console.log(`⚠ 건수 불일치 ${rows.length} → ${back.raw.length}`)
}
