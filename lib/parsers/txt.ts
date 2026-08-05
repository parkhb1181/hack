/**
 * txt 파서 — SPEC.md §3
 *
 * 핵심 전제: **CRLF가 레코드 구분자다.** 레코드 1개 = 메시지 1개.
 * 멀티라인 메시지는 레코드 내부에 순수 LF로 들어온다.
 * (실파일 검증: PC 23,465 / 안드 16,976 메시지, CRLF 분할 후 미분류 레코드 0)
 *
 * 시각은 UTC로 고정한다. 우리는 절대 시각이 아니라 간격만 쓰므로
 * 실행 환경 타임존에 결과가 흔들리지 않는 편이 이득이다.
 */

import { countableLength } from '@/lib/text'
import type { Msg, MsgType, Source, Who } from '@/lib/types'

/* ------------------------------ 정규식 ------------------------------ */

export const PC_TITLE = /^(.+?) 님과 카카오톡 대화$/
export const PC_DATE =
  /^-{5,}\s*(\d{4})년 (\d{1,2})월 (\d{1,2})일 [월화수목금토일]요일\s*-{5,}$/
export const PC_MSG = /^\[(.+?)\] \[(오전|오후) (\d{1,2}):(\d{2})\] ([\s\S]*)$/

export const AN_TITLE = /^(.+?) 님과 카카오톡 대화$/
export const AN_MSG =
  /^(\d{4})년 (\d{1,2})월 (\d{1,2})일 (오전|오후) (\d{1,2}):(\d{2}), (.+?) : ([\s\S]*)$/
export const AN_SYS =
  /^(\d{4})년 (\d{1,2})월 (\d{1,2})일 (오전|오후) (\d{1,2}):(\d{2}), (.+)$/
export const AN_DATE = /^(\d{4})년 (\d{1,2})월 (\d{1,2})일 (오전|오후) (\d{1,2}):(\d{2})$/

/* ------------------------------ iOS ------------------------------ */

/*
 * 아이폰 내보내기. 형태가 PC·안드로이드와 또 다르다.
 *
 *   Talk_2020.7.25 17:48-1.txt        ← 파일명 줄
 *   {방 이름} : 2026. 8. 5. 15:47      ← 저장한 날짜
 *
 *   2019년 5월 13일 월요일              ← 날짜 구분선
 *   2019. 5. 13. 16:06, {이름} : {본문}
 *
 * **오전·오후가 없을 수 있다.** 실물(53KB)이 24시간제였다. 예전 `IOS_HINT`가
 * 오전/오후를 필수로 봐서 이 파일은 감지조차 안 됐고, `unknown`으로 떨어져
 * 한 건도 안 읽혔다.
 */
export const IOS_MSG =
  /^(\d{4})\. (\d{1,2})\. (\d{1,2})\. (?:(오전|오후) )?(\d{1,2}):(\d{2}), (.+?) : ([\s\S]*)$/
export const IOS_DATE = /^(\d{4})년 (\d{1,2})월 (\d{1,2})일 [월화수목금토일]요일$/
/** `{방 이름} : 2026. 8. 5. 15:47` — 방 이름이 1:1에서는 상대 이름이다 */
export const IOS_SAVED = /^(.+?) : (\d{4})\. (\d{1,2})\. (\d{1,2})\. (?:(오전|오후) )?\d{1,2}:\d{2}$/

/** 감지용 — 시각 표기가 둘 다 가능하다 */
export const IOS_HINT = /^\d{4}\. \d{1,2}\. \d{1,2}\. (?:(?:오전|오후) )?\d{1,2}:\d{2}, /

export const SYS_NOTS =
  /^(.+님이 (들어왔|나갔)습니다\.|메시지가 삭제되었습니다\.|관리자가 메시지를 가렸습니다\.|방장이 [\s\S]*변경되었습니다\.[\s\S]*)$/

const SAVED_LINE = /^저장한 날짜 : /

/* ------------------------------ 시각 정규화 ------------------------------ */

/**
 * 오전/오후 12시 처리 — SPEC §3.6
 *
 * 실측: PC 562건 / 안드 425건의 `오전 12시` 메시지가 존재한다.
 * 변환하지 않으면 자정 대화 1,000건이 정오로 튀고 세션 분할이 통째로 깨진다.
 */
export function to24h(ampm: string, hh: string | number): number {
  let h = typeof hh === 'number' ? hh : parseInt(hh, 10)
  if (ampm === '오전' && h === 12) h = 0
  if (ampm === '오후' && h !== 12) h += 12
  return h
}

const pad = (n: number) => String(n).padStart(2, '0')

/* ------------------------------ 본문 분류 ------------------------------ */

const MEDIA: [RegExp, MsgType][] = [
  [/^사진( \d+장)?$/, 'photo'],
  [/^동영상$/, 'photo'],
  [/^이모티콘$/, 'emoticon'],
  [/^음성메시지$/, 'voice'],
  [/^파일: /, 'file'],
  [/^샵검색: #/, 'file'],
]

/**
 * `charCount = 0` 강제가 미디어의 분량 지표 오염을 막는 유일한 방어선이다(SPEC §2).
 * `사진`(2자), `이모티콘`(4자)을 그대로 세면 미디어를 많이 보내는 쪽이 유리해진다.
 */
export function classifyBody(body: string): { type: MsgType; text: string | null } {
  const b = body.trim()
  for (const [re, type] of MEDIA) {
    if (re.test(b)) return { type, text: null }
  }
  return { type: 'text', text: body }
}

/* ------------------------------ 결과 타입 ------------------------------ */

export type SpeakerStat = {
  name: string
  count: number
  firstDate: string | null
  lastDate: string | null
}

export type ParseResult = {
  source: Source
  title: string | null
  /** who 미확정 상태의 원시 메시지 (표시명 그대로) */
  raw: RawMsg[]
  speakers: SpeakerStat[]
  /** 완전 제외된 삭제 메시지 총량 (SPEC §3.9) */
  deleted: number
  /** 제외된 시스템 메시지 */
  system: number
  /** 어떤 패턴에도 안 맞고 이어붙이지도 못한 레코드. 0이어야 한다 */
  unparsed: number
  /** 멀티라인 메시지 수 (골든 비교용) */
  multiline: number
  /** 자정(00:xx) 메시지 수 (골든 비교용) */
  midnight: number
}

export type RawMsg = {
  name: string
  ts: number
  date: string
  time: string
  type: MsgType
  text: string | null
}

/**
 * 더 이상 쓰이지 않는다 — PC·안드로이드·iOS를 모두 읽는다.
 *
 * 형식이 안 맞는 파일은 예외가 아니라 **결과로** 말한다: `raw.length === 0`이고
 * `unparsed`가 줄 수만큼 남는다. 호출부는 그걸 보고 안내하면 된다.
 *
 * @deprecated 새 코드에서 쓰지 마라. 남겨둔 건 기존 타입 가드 때문이다.
 */
export type UnsupportedFormat = { unsupported: 'ios' }

/* ------------------------------ 포맷 감지 ------------------------------ */

export function detectFormat(records: string[]): Source {
  let pc = 0
  let an = 0
  let ios = 0
  // iOS 줄이 안드로이드 패턴에도 걸릴 수 있어 **먼저** 본다
  for (const r of records.slice(0, 200)) {
    if (IOS_MSG.test(r)) ios += 1
    else if (PC_MSG.test(r)) pc += 1
    else if (AN_MSG.test(r)) an += 1
  }
  if (ios > pc && ios > an) return 'kakao_ios'
  if (pc === 0 && an === 0) return 'unknown'
  return pc >= an ? 'kakao_pc' : 'kakao_android'
}

/* ------------------------------ 본 파서 ------------------------------ */

export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

export function splitRecords(s: string): string[] {
  return stripBom(s).split('\r\n')
}

export function parseTxt(text: string): ParseResult | UnsupportedFormat {
  const records = splitRecords(text)
  const source = detectFormat(records)

  const raw: RawMsg[] = []
  let title: string | null = null
  let deleted = 0
  let system = 0
  let unparsed = 0
  let midnight = 0

  // PC는 날짜 구분선으로 현재 날짜를 들고 간다. 놓치면 그 뒤 전체 날짜가 틀어진다.
  let curY = 0
  let curM = 0
  let curD = 0

  const push = (
    name: string,
    y: number,
    mo: number,
    d: number,
    h: number,
    mi: number,
    body: string,
  ) => {
    const { type, text } = classifyBody(body)
    const ts = Date.UTC(y, mo - 1, d, h, mi)
    if (h === 0) midnight += 1
    raw.push({
      name,
      ts,
      date: `${y}-${pad(mo)}-${pad(d)}`,
      time: `${pad(h)}:${pad(mi)}`,
      type,
      text,
    })
  }

  for (const rec of records) {
    if (rec === '') continue

    // 1. 날짜 / 구분선
    const pcDate = PC_DATE.exec(rec)
    if (pcDate) {
      curY = +pcDate[1]
      curM = +pcDate[2]
      curD = +pcDate[3]
      continue
    }
    if (AN_DATE.test(rec)) continue

    if (source === 'kakao_ios') {
      if (IOS_DATE.test(rec)) continue
      // 맨 앞의 내보내기 파일명 줄(`Talk_2020.7.25 17:48-1.txt`).
      // 메시지가 하나도 안 나온 시점에만 본다 — 본문에 `.txt`가 들어간
      // 메시지를 헤더로 착각하면 안 된다.
      if (raw.length === 0 && /\.txt$/i.test(rec)) continue
    }

    // 제목 줄 / 저장 날짜 줄
    if (title == null) {
      const t = PC_TITLE.exec(rec)
      if (t) {
        title = t[1]
        continue
      }
      // iOS에는 `{상대} 님과 카카오톡 대화` 줄이 없다. 대신 저장 날짜 줄
      // 앞부분이 방 이름이고, 1:1에서는 그게 상대 이름이다.
      if (source === 'kakao_ios') {
        const s = IOS_SAVED.exec(rec)
        if (s) {
          title = s[1].trim()
          continue
        }
      }
    }
    if (SAVED_LINE.test(rec)) continue

    // 2. 메시지 (SYS보다 **먼저**. 뒤집으면 `시어머니님` 같은 닉네임이
    //    시스템 메시지로 오분류된다 — SPEC §3.4)
    if (source === 'kakao_pc') {
      const m = PC_MSG.exec(rec)
      if (m) {
        if (curY === 0) {
          unparsed += 1 // 날짜 구분선 이전의 메시지 — 시간축에 배치 불가
          continue
        }
        push(m[1], curY, curM, curD, to24h(m[2], m[3]), +m[4], m[5])
        continue
      }
    } else if (source === 'kakao_ios') {
      const m = IOS_MSG.exec(rec)
      if (m) {
        // 오전·오후가 없으면 이미 24시간제다. `to24h`는 접두어가 없으면
        // 시각을 그대로 돌려준다.
        push(m[7], +m[1], +m[2], +m[3], to24h(m[4], m[5]), +m[6], m[8])
        continue
      }
    } else {
      const m = AN_MSG.exec(rec)
      if (m) {
        push(m[7], +m[1], +m[2], +m[3], to24h(m[4], m[5]), +m[6], m[8])
        continue
      }
    }

    // 3. 시스템
    if (SYS_NOTS.test(rec)) {
      if (rec.startsWith('메시지가 삭제되었습니다')) deleted += 1
      else system += 1
      continue
    }
    if (source === 'kakao_android') {
      const s = AN_SYS.exec(rec)
      if (s) {
        if (s[7].includes('삭제되었습니다')) deleted += 1
        else system += 1
        continue
      }
    }

    // 4. 미매칭 → 직전 메시지에 이어붙임 (안전망)
    //    CRLF 분할이 성립하면 여기로 오는 레코드는 없어야 한다.
    const last = raw[raw.length - 1]
    if (last && last.type === 'text') {
      last.text = (last.text ?? '') + '\n' + rec
    } else {
      unparsed += 1
    }
  }

  const multiline = raw.filter((r) => r.text != null && r.text.includes('\n')).length

  return {
    source: source === 'unknown' ? 'unknown' : source,
    title,
    raw,
    speakers: speakerStats(raw),
    deleted,
    system,
    unparsed,
    multiline,
    midnight,
  }
}

export function isUnsupported(r: ParseResult | UnsupportedFormat): r is UnsupportedFormat {
  return 'unsupported' in r
}

/* ------------------------------ 화자 ------------------------------ */

function speakerStats(raw: RawMsg[]): SpeakerStat[] {
  const map = new Map<string, SpeakerStat>()
  for (const r of raw) {
    const cur = map.get(r.name)
    if (cur) {
      cur.count += 1
      if (cur.firstDate == null || r.date < cur.firstDate) cur.firstDate = r.date
      if (cur.lastDate == null || r.date > cur.lastDate) cur.lastDate = r.date
    } else {
      map.set(r.name, {
        name: r.name,
        count: 1,
        firstDate: r.date,
        lastDate: r.date,
      })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}

/**
 * 화자 병합 제안 — SPEC §3.11
 *
 * 3명 이상이 보여도 즉시 거절하지 않는다. 닉네임 변경이 1:1 대화를
 * 단톡으로 오탐하는 경우가 있어, 시간적으로 겹치지 않는 소수 화자는
 * 동일인 병합을 제안한다.
 */
export function suggestMerges(speakers: SpeakerStat[]): Array<[string, string]> {
  const out: Array<[string, string]> = []
  if (speakers.length < 3) return out
  const minor = speakers.slice(2)
  for (const m of minor) {
    for (const major of speakers.slice(0, 2)) {
      if (!m.lastDate || !major.firstDate || !m.firstDate || !major.lastDate) continue
      const disjoint = m.lastDate < major.firstDate || major.lastDate < m.firstDate
      if (disjoint) {
        out.push([m.name, major.name])
        break
      }
    }
  }
  return out
}

/** 1:1 대화만 다룬다 — 3인 이상은 선톡률·주도권의 의미가 달라진다(PRD §5) */
export const MAX_SPEAKERS = 2

export type GroupChatCheck = {
  isGroup: boolean
  /** 병합 제안을 반영한 뒤의 화자 수 */
  speakers: number
  /** 동일인으로 볼 수 있는 쌍 (닉네임 변경) */
  merges: Array<[string, string]>
}

/**
 * 단톡 판정 — SPEC §3.11
 *
 * 즉시 거절하지 않는다. 닉네임을 바꾼 1:1 대화가 여러 화자로 보일 수 있으므로,
 * 시간적으로 겹치지 않는 소수 화자를 먼저 병합해 본다. 그러고도 3명 이상이면 거절.
 *
 * **이 검사를 빼면 조용히 틀린 답이 나온다** — 실측: 398명짜리 단톡이
 * '나 1,237 / 상대 22,228'로 뭉개져 기울기 −68이 아무 경고 없이 산출됐다.
 */
export function checkGroupChat(speakers: SpeakerStat[]): GroupChatCheck {
  const merges = suggestMerges(speakers)
  const merged = new Set(merges.map(([from]) => from))
  const remaining = speakers.filter((s) => !merged.has(s.name)).length
  return { isGroup: remaining > MAX_SPEAKERS, speakers: remaining, merges }
}

export type WhoResolution = {
  /** 표시명 → who */
  map: Map<string, Who>
  /** 제목 줄에서 상대를 특정했는지. 실패하면 드롭다운을 띄운다 */
  resolved: boolean
  /** 3인 이상이면 지표를 만들지 않는다 */
  rejected: 'group_chat' | null
}

/** 제목 줄 `{상대} 님과 카카오톡 대화`와 불일치하는 화자 = 나 */
export function resolveWho(
  title: string | null,
  speakers: SpeakerStat[],
  overrideMe?: string,
): WhoResolution {
  const map = new Map<string, Who>()

  // 화자 수를 먼저 본다. 3인 이상이면 나머지를 전부 '상대'로 뭉개는 대신 거절한다.
  const group = checkGroupChat(speakers)
  if (group.isGroup) {
    return { map, resolved: false, rejected: 'group_chat' }
  }

  // 지정된 이름이 화자 목록에 없으면 **해석 실패로 돌린다.**
  //
  // 그냥 두면 아무도 'me'에 안 붙어 전원이 '상대'가 되고, 기울기가 한쪽 끝으로
  // 박힌 채 조용히 나온다 — 실측: 없는 이름을 넣었더니 균형 대화가 −67
  // (`strong_other`)로 나왔다. 에러가 아니라 그럴듯한 오답이라 더 위험하다.
  const known = new Set(speakers.map((s) => s.name))
  const meName =
    overrideMe != null
      ? known.has(overrideMe)
        ? overrideMe
        : undefined
      : title
        ? speakers.find((s) => s.name !== title)?.name
        : undefined

  if (!meName) {
    return { map, resolved: false, rejected: null }
  }

  // 병합 대상은 병합 대상과 같은 편에 붙인다
  const mergeTo = new Map(group.merges)
  for (const s of speakers) {
    const canonical = mergeTo.get(s.name) ?? s.name
    map.set(s.name, canonical === meName ? 'me' : 'other')
  }
  return { map, resolved: true, rejected: null }
}

/**
 * 원시 메시지 → 공통 스키마.
 * 표시명은 여기서 버려진다. 원본 이름은 이후 단계로 넘어가지 않는다(PRD §7.2).
 */
export function toMessages(raw: RawMsg[], who: Map<string, Who>): Msg[] {
  const out: Msg[] = []
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i]
    const w = who.get(r.name)
    if (!w) continue
    out.push({
      seq: out.length,
      who: w,
      ts: r.ts,
      date: r.date,
      time: r.time,
      type: r.type,
      text: r.type === 'text' ? r.text : null,
      // UTF-16 길이가 아니라 눈에 보이는 글자 수. 이모지는 분량에서 제외한다
      charCount: r.type === 'text' ? countableLength(r.text ?? '') : 0,
      emojiDesc: null,
      affect: null,
      confidence: 1.0,
    })
  }
  return out
}
