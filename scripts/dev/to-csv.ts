/** 시드 txt → CSV 변환 (iOS 내보내기 흉내) — 개발용 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isUnsupported, parseTxt } from '@/lib/parsers/txt'

const name = process.argv[2] ?? 'seed_onesided'
const p = parseTxt(readFileSync(join('fixtures', 'seeds', `${name}.pc.txt`), 'utf8'))
if (isUnsupported(p)) throw new Error('형식 미지원')

const q = (s: string) => `"${s.replace(/"/g, '""')}"`
const rows = ['Date,User,Message']
for (const r of p.raw) {
  const body = r.type === 'text' ? (r.text ?? '') : r.type === 'emoticon' ? '이모티콘' : '사진'
  rows.push(`${r.date} ${r.time}:00,${q(r.name)},${q(body)}`)
}
const out = join('fixtures', 'seeds', `${name}.csv`)
writeFileSync(out, rows.join('\n'), 'utf8')
console.log(`${out}  ${p.raw.length}건 · 화자 ${p.speakers.map((s) => s.name).join(', ')}`)
