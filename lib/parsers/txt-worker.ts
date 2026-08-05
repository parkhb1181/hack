/**
 * txt 파싱 Web Worker — SPEC.md §3.10
 *
 * **대화 원문은 메인 스레드로 넘어가지 않는다.** Worker가 파싱·집계하고
 * 판독 창 120개와 통계만 돌려준다. 이것이 `PRD.md` §7.1 배지
 * "기기에서 파싱됨 — 대화 원문 전체는 서버에 전송되지 않습니다"의 근거다.
 *
 * 수십만 메시지 객체를 통째로 넘기면 모바일에서 OOM이 난다(§3.10 반환 계약).
 */

/// <reference lib="webworker" />

import { buildCorpus, bursts, sessions } from '@/lib/corpus'
import { WINDOW_SIZE, type Corpus, type Msg } from '@/lib/types'
import {
  checkGroupChat,
  isUnsupported,
  parseTxt,
  resolveWho,
  toMessages,
  type SpeakerStat,
} from './txt'

export type WorkerRequest =
  | { kind: 'parse'; file: File; overrideMe?: string }
  | { kind: 'cancel' }

export type WorkerResponse =
  | { kind: 'progress'; ratio: number; stage: string }
  | { kind: 'needs-speaker'; speakers: SpeakerStat[] }
  | { kind: 'rejected'; reason: 'group_chat' | 'ios' | 'unparseable'; speakers?: number }
  | { kind: 'done'; payload: ParsePayload }
  | { kind: 'error'; message: string }

/**
 * Worker가 돌려주는 전부.
 *
 * `window`(최근 120개)만 원문을 담는다 — 임베딩 옵트인 대상과 정확히 같은 범위다.
 * 나머지 메시지는 통계로만 요약해서 넘긴다.
 */
export type ParsePayload = {
  source: Corpus['source']
  /** 헤드라인·임베딩용 판독 창 */
  window: Msg[]
  /** 지표 계산에 필요한 집계 (원문 없음) */
  summary: {
    total: number
    byWho: { me: number; other: number }
    byType: Record<string, number>
    bursts: { me: number; other: number }
    sessions: number
    months: number
    infoUnits: number
    deleted: number
    multiline: number
    midnight: number
    unparsed: number
  }
  /** 명장면 후보 — 클라이언트 전용, LLM 미전송(MODELS §4.1) */
  highlights: Msg[]
  gaps: string[]
}

/** 명장면 후보 상한 — §3.10 */
export const HIGHLIGHT_CAP = 100

function summarize(msgs: Msg[], c: Corpus, parsed: {
  deleted: number
  multiline: number
  midnight: number
  unparsed: number
}): ParsePayload['summary'] {
  const byWho = { me: 0, other: 0 }
  const byType: Record<string, number> = {}
  for (const m of msgs) {
    byWho[m.who] += 1
    byType[m.type] = (byType[m.type] ?? 0) + 1
  }
  const bs = bursts(msgs)
  const months = new Set(msgs.map((m) => m.date?.slice(0, 7)).filter(Boolean))

  return {
    total: msgs.length,
    byWho,
    byType,
    bursts: {
      me: bs.filter((b) => b.who === 'me').length,
      other: bs.filter((b) => b.who === 'other').length,
    },
    sessions: sessions(msgs).length,
    months: months.size,
    infoUnits: c.infoUnits,
    deleted: parsed.deleted,
    multiline: parsed.multiline,
    midnight: parsed.midnight,
    unparsed: parsed.unparsed,
  }
}

/** 긴 텍스트 위주로 뽑는다 — 짧은 반응은 명장면이 되지 않는다 */
function pickHighlights(msgs: Msg[]): Msg[] {
  return [...msgs]
    .filter((m) => m.type === 'text' && m.charCount >= 15)
    .sort((a, b) => b.charCount - a.charCount)
    .slice(0, HIGHLIGHT_CAP)
    .sort((a, b) => a.seq - b.seq)
}

/**
 * 파일 하나를 파싱해 반환 계약을 만든다.
 *
 * Worker 밖에서도 테스트할 수 있도록 순수 함수로 분리했다.
 */
export function parseFileText(
  text: string,
  overrideMe?: string,
): WorkerResponse {
  const parsed = parseTxt(text)
  if (isUnsupported(parsed)) return { kind: 'rejected', reason: 'ios' }
  if (parsed.raw.length === 0) return { kind: 'rejected', reason: 'unparseable' }

  const group = checkGroupChat(parsed.speakers)
  const who = resolveWho(parsed.title, parsed.speakers, overrideMe)

  if (who.rejected === 'group_chat') {
    return { kind: 'rejected', reason: 'group_chat', speakers: group.speakers }
  }
  if (!who.resolved) {
    return { kind: 'needs-speaker', speakers: parsed.speakers }
  }

  const msgs = toMessages(parsed.raw, who.map)
  const c = buildCorpus(msgs, {
    mode: 'txt',
    source: parsed.source,
    deleted: parsed.deleted,
  })

  return {
    kind: 'done',
    payload: {
      source: parsed.source,
      window: c.window,
      summary: summarize(msgs, c, parsed),
      highlights: pickHighlights(msgs),
      gaps: c.gaps,
    },
  }
}

/* ------------------------------ Worker 본체 ------------------------------ */

/**
 * 스트리밍 읽기 — §3.10
 *
 * **캐리 버퍼가 없으면 20MB에서 확률적으로 깨진다.** 청크 경계가 `\r`과 `\n`
 * 사이에 떨어질 수 있기 때문이다. 여기서는 레코드 조립까지만 하고 파싱은
 * 전량이 모인 뒤에 한다 — 날짜 구분선 상태를 들고 가야 해서다(§3.7).
 */
export async function readWithCarry(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<string> {
  // 진행률은 **바이트**로 센다. 디코딩된 글자 수로 세면 한글이 UTF-8에서
  // 3바이트라 비율이 1에 도달하지 않는다(실측: 0.54에서 멈췄다).
  let read = 0
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      read += chunk.byteLength
      controller.enqueue(chunk)
    },
  })

  const reader = file
    .stream()
    .pipeThrough(counter)
    // TextDecoderStream의 writable은 BufferSource라 타입이 정확히 맞지 않는다.
    // 런타임 동작에는 문제가 없으므로 여기서만 좁힌다.
    .pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>)
    .getReader()
  const parts: string[] = []
  let carry = ''

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    const buf = carry + value
    const idx = buf.lastIndexOf('\r\n')
    if (idx === -1) {
      carry = buf
    } else {
      parts.push(buf.slice(0, idx + 2))
      carry = buf.slice(idx + 2) // 마지막 미완결 조각 보관 ← 필수
    }
    onProgress?.(Math.min(1, read / Math.max(1, file.size)))
  }
  if (carry) parts.push(carry)
  return parts.join('')
}

// 워커 컨텍스트에서만 리스너를 건다 (테스트에서 import해도 안전하게)
declare const self: DedicatedWorkerGlobalScope | undefined

if (typeof self !== 'undefined' && typeof (self as DedicatedWorkerGlobalScope).postMessage === 'function') {
  const ctx = self as DedicatedWorkerGlobalScope
  ctx.addEventListener('message', async (e: MessageEvent<WorkerRequest>) => {
    const req = e.data
    if (req.kind !== 'parse') return
    try {
      ctx.postMessage({ kind: 'progress', ratio: 0, stage: '읽는 중' } satisfies WorkerResponse)
      const text = await readWithCarry(req.file, (ratio) =>
        ctx.postMessage({ kind: 'progress', ratio, stage: '읽는 중' } satisfies WorkerResponse),
      )
      ctx.postMessage({ kind: 'progress', ratio: 1, stage: '파싱 중' } satisfies WorkerResponse)
      ctx.postMessage(parseFileText(text, req.overrideMe))
    } catch (err) {
      ctx.postMessage({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      } satisfies WorkerResponse)
    }
  })
}

export { WINDOW_SIZE }
