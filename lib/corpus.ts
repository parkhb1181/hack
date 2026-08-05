/**
 * Corpus 파생 계산 — SPEC.md §1, §2, §6.1
 *
 * 순수 함수만 둔다. 네트워크·모델 의존 없음 → 골든 테스트 대상(TESTPLAN §0).
 */

import {
  type Burst,
  type Corpus,
  type Field,
  type Mode,
  type Msg,
  type Semantic,
  type Session,
  type Source,
  type Transition,
  type Who,
  SESSION_GAP_MS,
  WINDOW_SIZE,
} from './types'

/* ------------------------------------------------------------------ *
 * 정보 단위 — SPEC §6.1
 * ------------------------------------------------------------------ */

/**
 * 표본 크기 척도. 메시지 개수를 그대로 쓰지 않는 이유는
 * `ㅇㅇ` 200개와 의미 있는 문장 20개의 정보량이 다르기 때문이다.
 *
 * 다만 **짧은 말도 차례는 차례다.** 한국어 카톡에서 `안` `아남` `집이여` 같은
 * 1~3자가 대화의 절반을 차지하고, 그것들이 바로 누가 먼저 말을 걸고 누가
 * 답하는지를 나른다 — A급 지표 대부분이 그 짧은 차례로 계산된다. 그래서
 * 0.1이 아니라 0.4다. 문장과 같지는 않으니 1.0도 아니다(SPEC §6.1).
 */
export function infoUnitOf(m: Msg): number {
  switch (m.type) {
    case 'text': {
      const n = m.charCount
      if (n >= 10) return 1.0
      if (n >= 3) return 0.7
      return 0.4
    }
    case 'emoticon':
      // affect가 있을 때만 높다. txt의 `이모티콘` 플레이스홀더는 정보량이 0에 가깝다.
      return m.affect ? 1.2 : 0.1
    case 'photo':
      return 0.3
    case 'nontext':
      // 자리는 알지만 내용을 모른다. txt의 이모티콘 플레이스홀더와 같은 취급 —
      // Vision 2패스가 종류와 정서를 채우면 emoticon/photo로 승격된다.
      return 0.1
    default:
      return 0
  }
}

export function infoUnits(msgs: Msg[]): number {
  return round2(msgs.reduce((sum, m) => sum + infoUnitOf(m), 0))
}

/* ------------------------------------------------------------------ *
 * 버스트 / 세션 / 전환 쌍 — SPEC §1
 * ------------------------------------------------------------------ */

/** 같은 화자의 연속 메시지 묶음. 정의상 두 사람의 버스트 수는 항상 ±1 */
export function bursts(msgs: Msg[]): Burst[] {
  const out: Burst[] = []
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    const last = out[out.length - 1]
    if (last && last.who === m.who) last.msgs.push(m)
    else out.push({ who: m.who, msgs: [m], start: i })
  }
  return out
}

/**
 * 직전 메시지와 6시간 이상 벌어지면 새 세션.
 *
 * ts가 없으면 세션을 나누지 않는다. 캡처의 이미지 경계는 세션 경계가 아니라
 * 불확정 경계이며(SPEC §1), 캡처 3~4장은 통상 단일 세션이다.
 */
export function sessions(msgs: Msg[]): Session[] {
  if (msgs.length === 0) return []
  const out: Session[] = []
  let cur: Msg[] = []
  let start = 0

  const flush = () => {
    if (cur.length === 0) return
    out.push({
      msgs: cur,
      start,
      opener: cur[0].who,
      closer: cur[cur.length - 1].who,
    })
  }

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    const prev = cur[cur.length - 1]
    const broke =
      prev != null &&
      prev.ts != null &&
      m.ts != null &&
      m.ts - prev.ts >= SESSION_GAP_MS
    if (broke) {
      flush()
      cur = []
      start = i
    }
    cur.push(m)
  }
  flush()
  return out
}

/** 'HH:mm' → 분. 파싱 불가면 null */
function minuteOfDay(time: string | null): number | null {
  if (!time) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!m) return null
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

/**
 * 전환 쌍의 간격(분).
 *
 * ts가 있으면 그대로. 없고 time만 있으면 자정 넘김 보정을 건다(SPEC §4.4).
 * 보정 후에도 6시간을 넘으면 다른 날일 수 있으므로 제외(null)한다.
 */
export function transitionDelta(prev: Msg, next: Msg): number | null {
  if (prev.ts != null && next.ts != null) {
    const d = (next.ts - prev.ts) / 60000
    return d >= 0 ? d : null
  }
  const a = minuteOfDay(prev.time)
  const b = minuteOfDay(next.time)
  if (a == null || b == null) return null
  let delta = b - a
  if (delta < 0) delta += 1440 // 자정 넘김 가정
  if (delta > 360) return null // 6시간 초과 → 다른 날일 수 있음, 전환 쌍에서 제외
  return delta
}

/** (상대 버스트의 마지막 메시지, 내 첫 응답) */
export function transitions(msgs: Msg[]): Transition[] {
  const bs = bursts(msgs)
  const out: Transition[] = []
  for (let i = 1; i < bs.length; i++) {
    const prevBurst = bs[i - 1]
    const curBurst = bs[i]
    const prev = prevBurst.msgs[prevBurst.msgs.length - 1]
    const next = curBurst.msgs[0]
    out.push({
      responder: curBurst.who,
      prev,
      next,
      deltaMin: transitionDelta(prev, next),
    })
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 필드 가용성 — PRD §4.2 (입력 모드 → 필드 가용성 → 지표 가용성)
 * ------------------------------------------------------------------ */

/**
 * 데이터에서 직접 판정한다. 모드를 보고 하드코딩하지 않는다.
 *
 * `continuity`(시간축 연속성)만 예외적으로 gaps를 함께 본다.
 * 스크롤 끊김이 기록된 코퍼스는 "누락 없음"을 보장할 수 없기 때문이다.
 */
export function detectFields(msgs: Msg[], gaps: string[]): Set<Field> {
  const f = new Set<Field>()
  if (msgs.length === 0) return f

  f.add('who')
  f.add('type')

  const all = (pred: (m: Msg) => boolean) => msgs.every(pred)
  const some = (pred: (m: Msg) => boolean) => msgs.some(pred)

  if (all((m) => m.ts != null)) f.add('ts')
  if (all((m) => m.date != null)) f.add('date')
  if (some((m) => m.time != null)) f.add('time')
  if (some((m) => m.type === 'text' && m.text != null)) f.add('text')
  if (some((m) => m.affect != null)) f.add('affect')

  // 시간축 연속성: 전 구간 ts가 있고, 끊김 기록이 없어야 한다.
  const broken = gaps.some((g) => g.startsWith('scroll_break'))
  if (f.has('ts') && f.has('date') && !broken) f.add('continuity')

  return f
}

/* ------------------------------------------------------------------ *
 * Corpus 조립
 * ------------------------------------------------------------------ */

export type BuildOpts = {
  mode: Mode
  source?: Source
  gaps?: string[]
  /** 임베딩 가용 여부(옵트인 + 성공). 4번째 축을 켠다. */
  embedding?: boolean
  semantic?: Semantic | null
  /** 파서가 제외한 삭제 메시지 총량 */
  deleted?: number
}

export function buildCorpus(messages: Msg[], opts: BuildOpts): Corpus {
  const gaps = [...(opts.gaps ?? [])]
  const sorted = messages.map((m, i) => ({ ...m, seq: i }))

  if (sorted.length > 0 && sorted.some((m) => m.ts == null)) {
    if (!gaps.includes('ts_missing')) gaps.push('ts_missing')
  }

  const fields = detectFields(sorted, gaps)
  if (opts.embedding) fields.add('embedding')

  // 판독 창 = 가장 최근 메시지 120개 (PRD §3.3)
  const win = sorted.slice(-WINDOW_SIZE)

  return {
    mode: opts.mode,
    source: opts.source ?? 'unknown',
    messages: sorted,
    window: win,
    availableFields: fields,
    infoUnits: infoUnits(sorted),
    windowFilled: win.length,
    gaps,
    counters: { deleted: opts.deleted ?? 0 },
    semantic: opts.semantic ?? null,
  }
}

/* ------------------------------------------------------------------ *
 * 소소한 헬퍼
 * ------------------------------------------------------------------ */

export function byWho<T>(items: T[], pick: (t: T) => Who): Record<Who, T[]> {
  const out: Record<Who, T[]> = { me: [], other: [] }
  for (const it of items) out[pick(it)].push(it)
  return out
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** 코퍼스의 scope에 맞는 메시지 집합 */
export function scoped(c: Corpus, scope: 'window' | 'full'): Msg[] {
  return scope === 'window' ? c.window : c.messages
}
