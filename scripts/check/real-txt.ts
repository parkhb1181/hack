/**
 * 실파일 파서 검증 — `npx tsx scripts/check/real-txt.ts <경로>`
 *
 * TESTPLAN §1.1 체크리스트. **대화 내용은 출력하지 않는다** — 구조 통계만 본다.
 * 화자 이름도 마스킹한다.
 */

import { readFileSync } from 'node:fs'

import { buildCorpus, bursts, sessions } from '@/lib/corpus'
import { CATALOG } from '@/lib/metrics/catalog'
import { evaluateAll } from '@/lib/metrics/registry'
import {
  checkGroupChat,
  isUnsupported,
  parseTxt,
  resolveWho,
  splitRecords,
  suggestMerges,
  toMessages,
} from '@/lib/parsers/txt'
import { computeHeadline } from '@/lib/stats/headline'
import { countMonths, countSessions } from '@/lib/metrics/temporal'

const path = process.argv[2] ?? 'fixtures/real/export_pc.txt'
const raw = readFileSync(path, 'utf8')

const records = splitRecords(raw)
const started = Date.now()
const parsed = parseTxt(raw)
const parseMs = Date.now() - started

if (isUnsupported(parsed)) {
  console.log('iOS 포맷 — 지원하지 않습니다')
  process.exit(0)
}

const mask = (s: string) => (s.length <= 1 ? '□' : s[0] + '□'.repeat(Math.min(3, s.length - 1)))

console.log('■ 파싱')
console.log(`  포맷          ${parsed.source}`)
console.log(`  레코드        ${records.length.toLocaleString('ko-KR')}개 (CRLF 분할)`)
console.log(`  메시지        ${parsed.raw.length.toLocaleString('ko-KR')}개`)
console.log(`  미분류        ${parsed.unparsed}개   ${parsed.unparsed === 0 ? '✅' : '❌ 지표가 틀어진다'}`)
console.log(`  멀티라인      ${parsed.multiline.toLocaleString('ko-KR')}개`)
console.log(`  자정(00시)    ${parsed.midnight.toLocaleString('ko-KR')}개`)
console.log(`  삭제 메시지   ${parsed.deleted}개`)
console.log(`  시스템        ${parsed.system}개`)
console.log(`  소요          ${parseMs}ms`)

console.log('\n■ 화자')
console.log(`  제목 줄       ${parsed.title ? mask(parsed.title) : '(없음)'}`)
for (const s of parsed.speakers.slice(0, 6)) {
  console.log(
    `  ${mask(s.name).padEnd(6)} ${String(s.count).padStart(7)}개  ${s.firstDate} ~ ${s.lastDate}`,
  )
}
if (parsed.speakers.length > 6) console.log(`  … 외 ${parsed.speakers.length - 6}명`)

const merges = suggestMerges(parsed.speakers)
if (merges.length) {
  console.log(`  병합 제안     ${merges.map(([a, b]) => `${mask(a)}→${mask(b)}`).join(', ')}`)
}

const check = checkGroupChat(parsed.speakers)
console.log(`  총 화자       ${parsed.speakers.length}명 → 병합 후 ${check.speakers}명`)

const who = resolveWho(parsed.title, parsed.speakers)
if (who.rejected === 'group_chat') {
  console.log(`\n■ 거절 — 단톡(${check.speakers}명)`)
  console.log('  3인 이상은 선톡률·주도권의 의미가 달라져 분석하지 않습니다 (PRD §5)')
  process.exit(0)
}
console.log(`  화자 확정     ${who.resolved ? '성공' : '실패 — 드롭다운 필요'}`)
if (!who.resolved) process.exit(0)

const msgs = toMessages(parsed.raw, who.map)
const c = buildCorpus(msgs, { mode: 'txt', source: parsed.source, deleted: parsed.deleted })

const byWho = { me: 0, other: 0 }
const byType: Record<string, number> = {}
for (const m of msgs) {
  byWho[m.who] += 1
  byType[m.type] = (byType[m.type] ?? 0) + 1
}
const bs = bursts(msgs)

console.log('\n■ 코퍼스')
console.log(`  메시지        나 ${byWho.me.toLocaleString('ko-KR')} / 상대 ${byWho.other.toLocaleString('ko-KR')}`)
console.log(`  타입          ${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(' ')}`)
console.log(`  버스트        나 ${bs.filter((b) => b.who === 'me').length} / 상대 ${bs.filter((b) => b.who === 'other').length}`)
console.log(`  세션          ${countSessions(c)}개`)
console.log(`  관측          ${countMonths(c)}개월`)
console.log(`  정보 단위     ${c.infoUnits.toLocaleString('ko-KR')}`)
console.log(`  판독 창       ${c.windowFilled}개`)
console.log(`  가용 필드     ${[...c.availableFields].join(', ')}`)

const h = computeHeadline(c, null)
console.log('\n■ 헤드라인')
console.log(`  기울기        ${h.tilt} (${h.band})  ${h.axesUsed}/${h.axesTotal}축`)
console.log(`  축            ${JSON.stringify(h.axes)}`)

console.log('\n■ 지표 상태')
const m = evaluateAll(CATALOG, c)
for (const [k, r] of Object.entries(m)) {
  const detail =
    r.status === 'OK'
      ? 'OK'
      : r.status === 'LOCKED'
        ? `LOCKED (${r.missing.join(',')})`
        : `INSUFFICIENT ${Math.floor(r.have)}/${r.need}`
  console.log(`  ${k.padEnd(14)} ${detail}`)
}
