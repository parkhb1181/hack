/**
 * 공통 스키마 — SPEC.md §2
 *
 * 두 파서(txt / 캡처)가 이 구조 하나로 수렴한다.
 * 지표 코드는 `mode`를 절대 보지 않는다. 경로 차이는 오직 필드 결측으로만 표현된다(PRD §4.2).
 */

export type Who = 'me' | 'other'

export type MsgType =
  | 'text'
  | 'photo'
  | 'emoticon'
  | 'file'
  | 'voice'
  | 'deleted'
  /**
   * 글자 없는 발화인데 무엇인지 아직 모르는 상태 — 캡처 전용.
   *
   * OCR은 스티커·사진을 못 본다. 자리는 여백으로 찾을 수 있지만 종류는
   * 픽셀을 봐야 안다. 그때까지 `nontext`로 둔다.
   *
   * **버려서는 안 된다.** 발화가 빠지면 앞뒤 메시지가 한 버스트로 잘못 합쳐져
   * 메시지 수·응답 지연·동조율이 전부 오염된다. 지표 하나가 꺼지는 문제가 아니다.
   */
  | 'nontext'

export const MSG_TYPES: readonly MsgType[] = [
  'text',
  'photo',
  'emoticon',
  'file',
  'voice',
  'deleted',
  'nontext',
]

export type Affect = {
  /** -1.0(부정) ~ +1.0(긍정) */
  valence: number
  /** 0.0(약함) ~ 1.0(강함) */
  intensity: number
}

export type Msg = {
  /** 병합·정렬 후 최종 순서 */
  seq: number
  who: Who
  /** epoch ms. 캡처는 대부분 null */
  ts: number | null
  /** 'YYYY-MM-DD'. 캡처는 날짜 구분선이 보일 때만 */
  date: string | null
  /** 'HH:mm' (24h 정규화 완료) */
  time: string | null
  type: MsgType
  /** type === 'text' 일 때만 채움 */
  text: string | null
  /** type !== 'text' 이면 무조건 0 (SPEC §2 강제) */
  charCount: number
  /** Vision 2패스. 캡처 전용 */
  emojiDesc: string | null
  /** 캡처 전용 정서 좌표 */
  affect: Affect | null
  /** txt = 1.0, 캡처 = Vision 반환값 */
  confidence: number
}

export type Field =
  | 'who'
  | 'ts'
  | 'date'
  | 'time'
  | 'text'
  | 'type'
  | 'affect'
  | 'continuity'
  | 'embedding'

export type Mode = 'txt' | 'capture'
/** `kakao_ios`는 CSV 내보내기다 — iOS는 txt를 주지 않는다 */
export type Source = 'kakao_pc' | 'kakao_android' | 'kakao_ios' | 'unknown'

/** 판독 창 크기 — PRD §3.3. 헤드라인은 항상 이 표본 크기로 계산된다. */
export const WINDOW_SIZE = 120

/** 세션 임계값. 시간 판정의 유일한 임계값 — SPEC §1 */
export const SESSION_GAP_MS = 6 * 60 * 60 * 1000

/**
 * 임베딩 산출물. 옵트인 + 성공 시에만 채워진다.
 * 모델은 벡터만 반환하고 코사인·중심·분산은 전부 코드가 계산한다(MODELS §3.4).
 */
export type Semantic = {
  syncMe: number
  syncOther: number
  /** 말투 분리도 0~100 */
  styleSep: number
  /** 동조율 계산에 쓰인 전환 쌍 수 */
  pairs: number
  /** 화자별 임베딩 대상 메시지 수 */
  vectors: Record<Who, number>
}

export type Corpus = {
  mode: Mode
  source: Source
  /** 전체 */
  messages: Msg[]
  /** 최근 120개 (헤드라인용) */
  window: Msg[]
  availableFields: Set<Field>
  infoUnits: number
  /** window.length */
  windowFilled: number
  /** 'ts_missing' | 'scroll_break:img2' | 'name_merged:2->1' */
  gaps: string[]
  /**
   * 메시지 배열에서 제외된 항목의 총량.
   * 삭제 메시지는 타임스탬프가 없어 시간축에 배치할 수 없으므로
   * messages[]에 넣지 않고 개수만 센다(SPEC §3.9).
   */
  counters: { deleted: number }
  /** 임베딩 레이어 산출물. `availableFields`에 'embedding'이 있을 때만 유효 */
  semantic?: Semantic | null
}

/** 화자가 교대하는 연속 메시지 묶음 — SPEC §1 */
export type Burst = {
  who: Who
  msgs: Msg[]
  /** messages 배열에서의 시작 인덱스 */
  start: number
}

/** 직전 메시지와 6시간 이상 벌어지면 새 세션 — SPEC §1 */
export type Session = {
  msgs: Msg[]
  start: number
  /** 세션 첫 메시지의 화자 */
  opener: Who
  /** 세션 마지막 버스트의 화자 */
  closer: Who
}

/** (상대 버스트의 마지막 메시지, 내 첫 응답) — SPEC §1 */
export type Transition = {
  /** 응답한 쪽 */
  responder: Who
  prev: Msg
  next: Msg
  /** 분 단위 간격. 계산 불가면 null */
  deltaMin: number | null
}

export type MetricStatus = 'OK' | 'LOCKED' | 'INSUFFICIENT'

export type MetricResult =
  | { status: 'OK'; value: unknown }
  | { status: 'LOCKED'; missing: Field[] }
  | { status: 'INSUFFICIENT'; have: number; need: number }

export type MetricSpec = {
  key: string
  label: string
  grade: 'A' | 'B' | 'C'
  /** 없으면 LOCKED */
  requires: Field[]
  minSamples: number
  /** 표본 단위 이름 (INSUFFICIENT 문구용) */
  sampleUnit: string
  /** 없으면 INSUFFICIENT */
  sampleCounter: (c: Corpus) => number
  /** 판독 창 vs 전체 */
  scope: 'window' | 'full'
  compute: (c: Corpus) => unknown
}

export type Band =
  | 'strong_me'
  | 'lean_me'
  | 'even'
  | 'lean_other'
  | 'strong_other'

/**
 * 관계 유형 — 지표 해석의 의미가 달라지므로 문구 전환에 쓴다(MODELS §4.3).
 *
 * `crush`(썸)에서는 비대칭의 방향이 뒤집혀 읽힌다: 내가 더 많이 보내는 것이
 * 다른 관계에서는 중립 관찰이지만, 썸에서는 "나만 다가가고 있다"로 읽힌다.
 * 그래도 **지표 계산은 stage를 보지 않는다.** 문구만 바뀐다.
 */
export type Stage = 'crush' | 'couple' | 'friend' | 'family' | 'work' | 'unknown'

export type Headline = {
  tilt: number
  band: Band
  axesUsed: number
  axesTotal: number
  precisionReduced: boolean
  /** 축별 원값 (골든 테스트·디버그용) */
  axes: Record<string, number>
}

/** 응답 계약 — SPEC §11 */
export type Report = {
  mode: Mode
  infoUnits: number
  windowFilled: number
  headline: Headline
  metrics: Record<string, MetricResult>
  gaps: string[]
}

/** 정보 단위가 하한(`HARD_FLOOR`)에 못 미치면 리포트를 만들지 않는다 — SPEC §6.2 */
export type HardFloor = {
  kind: 'hard_floor'
  infoUnits: number
  /** 확실히 말할 수 있는 것 하나 */
  singleFact: string | null
}
