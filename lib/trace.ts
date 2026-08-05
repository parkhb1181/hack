/**
 * 파이프라인 추적 — 개발자 모드가 보는 것.
 *
 * **화면이 파이프라인을 재구현하지 않는다.** 실제로 도는 코드가 단계마다 여기에
 * 기록을 남기고, 화면은 그것만 그린다. 그래야 개발자 모드가 보여주는 것과
 * 실제 동작이 어긋나지 않는다.
 *
 * 원문이 들어가는 필드에는 전부 주석으로 표시해 뒀다 — 이 객체는 브라우저까지
 * 가므로, 데모 화면에 띄울 때는 `maskTrace`를 거친다.
 */

import type { Msg } from './types'
import type { Box, Hole, OcrLine } from './parsers/ocr'

/** 필터 체인 한 단계 */
export type FilterStep = {
  name: string
  /** 이 단계를 통과한 줄 수 */
  kept: number
  /** 떨어뜨린 줄 — ⚠️ 원문 포함 */
  dropped: Array<{ text: string; box: Box; why: string }>
}

export type PageTrace = {
  label: string
  width: number
  height: number
  ocrSec: number | null
  /** OCR 원본 — ⚠️ 원문 포함 */
  rawLines: OcrLine[]
  filters: FilterStep[]
  bubbles: Array<{
    who: string
    box: Box
    time: string | null
    date: string | null
    /** ⚠️ 원문 포함 */
    text: string
  }>
  /** 비텍스트 구간 = Vision에 보낼 조각의 좌표 */
  holes: Hole[]
  speakers: number
  rejected: string | null
  /** ⚠️ 원문 포함 */
  messages: Msg[]
}

/** txt · csv 경로. 캡처의 `PageTrace`에 대응한다 */
export type TextTrace = {
  label: string
  kind: 'txt' | 'csv'
  source: string
  bytes: number
  /** 파일에서 읽어낸 원시 메시지 수 */
  records: number
  /** 형식에 안 맞아 건너뛴 줄 */
  unparsed: number
  /** 시간축에서 빠진 삭제 메시지 (개수만 센다 — SPEC §3.9) */
  deleted: number
  system: number
  speakers: Array<{ name: string; count: number; firstDate: string | null; lastDate: string | null }>
  /** 제목 줄에서 상대를 특정했는가. 실패하면 화면이 드롭다운을 띄운다 */
  resolvedBy: 'title' | 'user' | null
  rejected: string | null
}

export type VisionTrace = {
  enabled: boolean
  /** 실제로 보낸 프롬프트 전문 */
  prompt: string
  model: string
  /** 한도 등으로 건너뛴 모델들 */
  skipped: Array<{ model: string; why: string }>
  /** 조각별 좌표와 크기. 이미지 자체는 화면에 미리보기로만 준다 */
  crops: Array<{ page: string; y: [number, number]; width: number; height: number }>
  /** 구간 안에 글자가 몇 줄 걸렸는지 — 0이어야 한다 */
  enclosedTextLines: number
  /** Gemini 원 응답 (JSON 파싱 전) */
  rawResponse: string | null
  /** 검증을 통과한 항목 */
  items: unknown[]
  error: string | null
}

export type SemanticTrace = {
  enabled: boolean
  model: string
  /** 임베딩을 태운 메시지 수 / 건너뛴 수 */
  embedded: number
  skipped: number
  cacheHits: number
  elapsedMs: number
  /**
   * 코사인 원값 0~1 — **이 숫자만 보면 안 된다.**
   * 어떤 대화든 0.6~0.7에 몰리므로 무작위 짝 기준선을 빼야 의미가 생긴다.
   */
  raw: { me: number; other: number } | null
  baseline: { me: number; other: number } | null
  /** 감산 후 = 실제로 지표에 쓰이는 값 */
  net: { me: number; other: number } | null
  pairs: number
  styleSep: number | null
  /** 헤드라인 동조 축 (-1~+1). 감산 후 차이를 SYNC_SCALE로 나눈 값 */
  axis: number | null
  error: string | null
}

export type LlmTrace = {
  /** 시스템 프롬프트 전문 */
  system: string
  /** 관계 유형 줄 */
  stageLine: string
  /** 실제로 보낸 집계 블록 — 여기에 원문이 없다는 것이 요점이다 */
  block: string
  model: string
  /** 한도 등으로 건너뛴 모델들 */
  skipped: Array<{ model: string; why: string }>
  /** 최종 문장 */
  text: string
  source: 'llm' | 'fallback'
  reason: string | null
  elapsedMs: number
  verify: unknown
}

export type Trace = {
  mode: 'capture' | 'txt'
  /** 캡처 경로에서만 채워진다 */
  pages: PageTrace[]
  /** txt · csv 경로에서만 채워진다 */
  text: TextTrace | null
  /** 이미지 간 겹침 병합 */
  merge: {
    pages: number
    before: number
    after: number
    removed: number
    /** 겹침으로 순서를 다시 세웠는가 */
    reordered: boolean
    /** 실제로 이어붙인 순서 */
    order: string[]
  } | null
  corpus: {
    windowFilled: number
    infoUnits: number
    availableFields: string[]
    gaps: string[]
    /**
     * 두 다리가 만난 뒤의 최종 `Msg[]` — ⚠️ 원문 포함.
     *
     * 앞부분만 담는다. txt는 수천 건이 나오는데 전부 실어 보내면 응답이
     * 수 MB가 된다. 지표는 전량으로 계산되고, 여기 있는 건 눈으로 보기 위한 것이다.
     */
    messages: Msg[]
    /** 잘라낸 건수. 0이면 전부 담겼다 */
    truncated: number
  }
  vision: VisionTrace | null
  semantic: SemanticTrace | null
  llm: LlmTrace | null
  timings: Record<string, number>
}

/* --------------------------- 마스킹 --------------------------- */

/** 글자 수만 남긴다 */
function maskText(s: string): string {
  const t = s.trim()
  if (!t) return t
  return `${t.slice(0, 1)}${'●'.repeat(Math.max(0, [...t].length - 1))}`
}

/**
 * 원문을 가린 사본을 만든다.
 *
 * 익명화가 아니다 — 이름을 가명으로 **바꾸는** 단계는 파이프라인에 없고,
 * 필요하지도 않다(화자는 `me`/`other`로만 남는다). 이건 화면 공유·스크린샷용
 * 가리개다. 지표는 마스킹 전 값으로 이미 계산돼 있으므로 숫자는 그대로다.
 */
export function maskTrace(t: Trace): Trace {
  return {
    ...t,
    corpus: {
      ...t.corpus,
      messages: t.corpus.messages.map((m) => ({
        ...m,
        text: m.text == null ? null : maskText(m.text),
      })),
    },
    // 화자 표시명은 지표에 안 쓰이지만 추적 기록에는 남는다 — 가릴 때 같이 가린다
    text: t.text
      ? { ...t.text, speakers: t.text.speakers.map((s) => ({ ...s, name: maskText(s.name) })) }
      : null,
    pages: t.pages.map((p) => ({
      ...p,
      rawLines: p.rawLines.map((l) => ({ ...l, text: maskText(l.text) })),
      filters: p.filters.map((f) => ({
        ...f,
        dropped: f.dropped.map((d) => ({ ...d, text: maskText(d.text) })),
      })),
      bubbles: p.bubbles.map((b) => ({ ...b, text: maskText(b.text) })),
      messages: p.messages.map((m) => ({
        ...m,
        text: m.text == null ? null : maskText(m.text),
      })),
    })),
  }
}

