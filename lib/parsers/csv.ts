/**
 * CSV 대화 파서 — `Date, User, Message` 형태
 *
 * 카카오톡 **iOS**는 내보내기를 CSV로 준다. `txt.ts`가 iOS 텍스트 형식을
 * `unsupported`로 돌려보내는 이유가 여기 있다 — iOS는 애초에 txt가 아니다.
 *
 * 결과 타입은 `txt.ts`의 `ParseResult`를 그대로 쓴다. **두 경로가 같은 형태로
 * 수렴해야** 아래 단계가 입력 종류를 몰라도 된다(SPEC §2).
 *
 * ⚠️ 열 이름과 날짜 형식은 앱 버전·언어에 따라 갈린다. 실물 iOS 내보내기로
 * 검증하지 못했으므로 **관대하게** 받는다 — 열은 이름으로 찾고, 못 찾으면
 * 값의 모양으로 추정한다. 형식이 안 맞으면 조용히 틀리지 말고 거절한다.
 */

import { classifyBody, type ParseResult, type RawMsg, type SpeakerStat } from './txt'

/** 파싱 실패 — 어떤 열을 못 찾았는지 알려준다 */
export type CsvFailure = { unsupported: 'csv_shape'; detail: string }

export function isCsvFailure(r: ParseResult | CsvFailure): r is CsvFailure {
  return 'unsupported' in r
}

/* ------------------------------ 필드 쪼개기 ------------------------------ */

/**
 * RFC4180 방식으로 한 줄씩 끊는다.
 *
 * `split(',')`으로 하면 안 된다 — 메시지 본문에 쉼표와 **줄바꿈**이 들어간다.
 * 따옴표 안의 줄바꿈은 같은 레코드에 속하므로 문자 단위로 훑는다.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]

    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
      continue
    }

    if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }

  row.push(field)
  if (row.some((f) => f.trim() !== '')) rows.push(row)
  return rows
}

/* ------------------------------ 열 찾기 ------------------------------ */

const DATE_NAMES = ['date', 'time', 'datetime', '날짜', '시간', '일시']
const USER_NAMES = ['user', 'name', 'sender', 'speaker', '이름', '작성자', '보낸사람', '발신자']
const MSG_NAMES = ['message', 'text', 'content', 'msg', '메시지', '내용', '대화']

function findColumn(header: string[], names: string[]): number {
  const norm = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, ''))
  for (const n of names) {
    const at = norm.indexOf(n)
    if (at >= 0) return at
  }
  // 부분 일치 — `Date(UTC)` 같은 변형
  for (const n of names) {
    const at = norm.findIndex((h) => h.includes(n))
    if (at >= 0) return at
  }
  return -1
}

/* ------------------------------ 날짜 ------------------------------ */

const ISO = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})[ T]+(\d{1,2}):(\d{2})/
/** 카톡 iOS 표기 — `2018. 6. 25. 오후 8:23` */
const KO = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2})/

export type Stamp = { y: number; mo: number; d: number; h: number; mi: number }

export function parseStamp(s: string): Stamp | null {
  const t = s.trim()

  const iso = ISO.exec(t)
  if (iso) {
    return { y: +iso[1], mo: +iso[2], d: +iso[3], h: +iso[4], mi: +iso[5] }
  }

  const ko = KO.exec(t)
  if (ko) {
    let h = +ko[5]
    if (ko[4] === '오전' && h === 12) h = 0
    if (ko[4] === '오후' && h !== 12) h += 12
    return { y: +ko[1], mo: +ko[2], d: +ko[3], h, mi: +ko[6] }
  }

  return null
}

const pad = (n: number) => String(n).padStart(2, '0')

/* ------------------------------ 본체 ------------------------------ */

/** 헤더로 보기에 충분한지 — 세 열을 다 찾았는가 */
function looksLikeHeader(row: string[]): boolean {
  return (
    findColumn(row, DATE_NAMES) >= 0 &&
    findColumn(row, USER_NAMES) >= 0 &&
    findColumn(row, MSG_NAMES) >= 0
  )
}

export function parseCsv(text: string): ParseResult | CsvFailure {
  const rows = parseCsvRows(text)
  if (rows.length < 2) return { unsupported: 'csv_shape', detail: '행이 너무 적습니다' }

  let iDate: number
  let iUser: number
  let iMsg: number
  let start: number

  if (looksLikeHeader(rows[0])) {
    iDate = findColumn(rows[0], DATE_NAMES)
    iUser = findColumn(rows[0], USER_NAMES)
    iMsg = findColumn(rows[0], MSG_NAMES)
    start = 1
  } else {
    // 헤더가 없으면 첫 행의 **값 모양**으로 추정한다.
    // 날짜로 읽히는 열이 날짜, 나머지 둘 중 짧은 쪽이 이름.
    const sample = rows[0]
    iDate = sample.findIndex((f) => parseStamp(f) != null)
    if (iDate < 0) {
      return { unsupported: 'csv_shape', detail: '날짜 열을 찾지 못했습니다' }
    }
    const rest = sample.map((f, i) => ({ i, len: f.trim().length })).filter((x) => x.i !== iDate)
    if (rest.length < 2) {
      return { unsupported: 'csv_shape', detail: '이름·메시지 열이 없습니다' }
    }
    rest.sort((a, b) => a.len - b.len)
    iUser = rest[0].i
    iMsg = rest[rest.length - 1].i
    start = 0
  }

  const raw: RawMsg[] = []
  const counts = new Map<string, SpeakerStat>()
  let deleted = 0
  let unparsed = 0
  let midnight = 0

  for (let r = start; r < rows.length; r++) {
    const row = rows[r]
    const stamp = parseStamp(row[iDate] ?? '')
    const name = (row[iUser] ?? '').trim()
    const body = row[iMsg] ?? ''

    if (!stamp || !name) {
      unparsed += 1
      continue
    }

    const { type, text } = classifyBody(body)
    if (type === 'deleted') {
      // 삭제 메시지는 시간축에 두지 않고 개수만 센다 — SPEC §3.9
      deleted += 1
      continue
    }

    const date = `${stamp.y}-${pad(stamp.mo)}-${pad(stamp.d)}`
    if (stamp.h === 0) midnight += 1

    raw.push({
      name,
      ts: Date.UTC(stamp.y, stamp.mo - 1, stamp.d, stamp.h, stamp.mi),
      date,
      time: `${pad(stamp.h)}:${pad(stamp.mi)}`,
      type,
      text,
    })

    const stat = counts.get(name)
    if (stat) {
      stat.count += 1
      if (stat.firstDate == null || date < stat.firstDate) stat.firstDate = date
      if (stat.lastDate == null || date > stat.lastDate) stat.lastDate = date
    } else {
      counts.set(name, { name, count: 1, firstDate: date, lastDate: date })
    }
  }

  if (raw.length === 0) {
    return { unsupported: 'csv_shape', detail: '읽어낸 메시지가 없습니다' }
  }

  // 시간순 정렬 — CSV가 항상 정렬되어 있다고 볼 수 없다
  raw.sort((a, b) => a.ts - b.ts)

  return {
    source: 'kakao_ios',
    // CSV에는 `{상대} 님과 카카오톡 대화` 같은 제목 줄이 없다.
    // 화자 해석은 호출부가 드롭다운으로 받는다(§3.10).
    title: null,
    raw,
    speakers: [...counts.values()].sort((a, b) => b.count - a.count),
    deleted,
    system: 0,
    unparsed,
    // CSV는 본문이 한 칸 안에 통째로 들어오므로 줄바꿈이 있으면 멀티라인이다
    multiline: raw.filter((r) => r.text?.includes('\n')).length,
    midnight,
  }
}
