/**
 * OCR 어댑터 — 텍스트 줄 + bbox → 공통 스키마
 *
 * OCR 엔진(RapidOCR / PaddleOCR / EasyOCR)이 무엇이든 이 형태로 들어온다.
 * 여기서 하는 일은 전부 **결정론적 계산**이다. 모델이 관여하지 않는다.
 *
 * SPEC §4.6의 "배경색 기반 좌우 판별 금지"를 좌표로 대체한다 —
 * 좌표는 테마·다크모드와 무관하므로 §4.6의 의도를 더 강하게 만족한다.
 */

import { to24h } from './txt'
import { countableLength } from '@/lib/text'
import type { Msg, MsgType, Who } from '@/lib/types'

/* ------------------------------ 입력 형태 ------------------------------ */

/** [x0, y0, x1, y1] 픽셀 좌표 */
export type Box = [number, number, number, number]

export type OcrLine = {
  text: string
  box: Box
  confidence: number
}

export type OcrPage = {
  width: number
  height: number
  lines: OcrLine[]
}

const x0 = (b: Box) => b[0]
const y0 = (b: Box) => b[1]
const x1 = (b: Box) => b[2]
const y1 = (b: Box) => b[3]
const cy = (b: Box) => (b[1] + b[3]) / 2
const height = (b: Box) => b[3] - b[1]

/* ------------------------------ 줄 분류 ------------------------------ */

/**
 * `오전 10:23` / `오후 3:04` / `14:55` — 말풍선 옆 시각.
 *
 * **오전·오후는 선택이다.** 안드로이드 카톡을 24시간제로 쓰면 접두어 없이
 * `14:55`만 찍힌다. 실측(1206×2622 실물)에서 이걸 시각으로 못 알아본 결과가
 * 연쇄적으로 컸다 — 시각이 본문 취급을 받아 열 중앙값을 오염시켰고, 대화 영역
 * 경계를 못 잡았고, `14:54`가 **본문이 텍스트인 말풍선**으로 남았다.
 *
 * 대신 상태바 시각(`11:28`)도 같은 모양이 된다. 그건 `dropTopChrome`과
 * `dropOutlierTimes`가 잡는다 — 위치로 거르지, 모양으로 거르지 않는다.
 */
export const TIME_LABEL = /^(?:(오전|오후)\s*)?([01]?\d|2[0-3]):([0-5]\d)$/
/**
 * `2018년 9월 29일 토요일` — 날짜 구분선.
 *
 * 뒤의 꺾쇠는 실물에서 붙어 나온다 — 모바일 카톡은 구분선을 누르면 그 날짜로
 * 이동하는 버튼이라 `>` 아이콘이 있고, OCR이 그걸 글자로 붙인다. 안 받아주면
 * 구분선이 **본문 메시지로 남는다**(실측: `2026년 8월 1일 토요일>`).
 */
export const DATE_DIVIDER =
  /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(\s*[월화수목금토일]요일)?\s*[>›»〉]?$/

/**
 * 카톡 UI 아이콘이 글자로 잡힌 것 — 발화가 아니다.
 *
 * 한 글자짜리 기호만 본다. 실측에서 `#`(해시태그 버튼), `+`(첨부),
 * `↑`(사진 위 공유 버튼)이 각각 말풍선으로 잡혔고, 그중 `↑`는 사진 바로 위에
 * 놓여 **사진의 화자를 상대로 뒤집기까지 했다.**
 *
 * `?` `!` `.` `ㅋ` 같은 실제 한 글자 발화와 섞이면 안 되므로 목록을 못 박는다.
 */
export const UI_GLYPHS = new Set(['#', '+', '↑', '↓', '←', '→', '<', '>', '×', '✓', '⌄', '⌃'])

export function isUiGlyph(text: string): boolean {
  return UI_GLYPHS.has(text.trim())
}

/**
 * 화면 상하단 UI를 잘라내는 기본 비율 — 시각 라벨이 부족할 때의 폴백.
 *
 * 고정 비율만으로는 부족하다. 실측: PC 카톡(692x1172)은 헤더가 13%,
 * 입력창+툴바가 19%를 차지해 0.06으로는 "메시지 입력", "전송"이 본문에 섞였다.
 */
export const CHROME_RATIO = 0.06

/** 카톡 UI 고정 문구 — 대화 내용이 아니다 */
export const UI_CHROME = [
  '메시지 입력',
  '메시지를 입력하세요',
  '전송',
  '대화 상대 검색',
  '보내기',
]

export function isUiChrome(text: string): boolean {
  const t = text.trim()
  return UI_CHROME.some((u) => t === u || t.startsWith(u))
}

/**
 * 대화 영역의 세로 범위.
 *
 * 시각 라벨은 반드시 대화 영역 안에만 있다. 그 분포로 경계를 잡으면
 * 해상도·플랫폼(PC/모바일)에 상관없이 헤더와 입력창이 걸러진다.
 */
/**
 * 대화 영역에서 동떨어진 시각 라벨을 버린다.
 *
 * 스크롤·화면 전환 중에 찍은 캡처에는 이전/다음 화면이 반투명하게 비치고,
 * 거기 있는 시각까지 OCR에 잡힌다. 실측: 모바일 캡처 상단에 `오전 8:48`이
 * 유령으로 남아 대화 영역 판정을 통째로 망가뜨렸다.
 */
export function dropOutlierTimes(times: OcrLine[]): OcrLine[] {
  if (times.length < 3) return times
  const sorted = [...times].sort((a, b) => cy(a.box) - cy(b.box))
  const gaps = sorted.slice(1).map((t, i) => cy(t.box) - cy(sorted[i].box))
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
  const limit = median * 3

  let lo = 0
  while (lo < sorted.length - 2 && gaps[lo] > limit) lo += 1
  let hi = sorted.length - 1
  while (hi > lo + 1 && gaps[hi - 1] > limit) hi -= 1
  return sorted.slice(lo, hi + 1)
}

/**
 * 대화 영역의 아래 경계.
 *
 * 위 경계는 시각으로 못 잡는다 — 버스트가 스티커+멀티라인으로 길어지면
 * 첫 시각이 한참 아래에 찍힌다. 위쪽은 §열 정렬로 거른다.
 */
export function contentBand(page: OcrPage): [number, number] {
  // 입력창을 찾으면 그게 가장 확실한 아래 경계다 — 대화는 그 위에서 끝난다.
  //
  // 시각 기반 추정(`BOTTOM_MARGIN`)만으로는 부족했다. 실측(1206×2622): 마지막
  // 시각 15:01이 y2380에서 끝나 경계가 2537로 잡혔고, 입력창 우측의 `#` 버튼
  // (y2422)이 그 안에 들어와 **내가 보낸 메시지 "#"로 잡혔다.**
  // `메시지 입력`과 `#`은 같은 줄에 있으므로, 입력창 위치를 알면 같이 걸린다.
  const chrome = page.lines.filter((l) => isUiChrome(l.text))
  const inputTop = chrome.length ? Math.min(...chrome.map((l) => y0(l.box))) : Infinity

  const times = dropOutlierTimes(page.lines.filter((l) => isTimeLabel(l.text)))
  const estimated =
    times.length < 2
      ? page.height * (1 - CHROME_RATIO)
      : Math.max(...times.map((t) => y1(t.box))) +
        (times.reduce((s, t) => s + height(t.box), 0) / times.length) * BOTTOM_MARGIN

  return [0, Math.min(page.height, estimated, inputTop)]
}

/**
 * 마지막 시각 아래로 남겨둘 여유 — 글자 높이 배수.
 *
 * 가장 최근 버스트는 아직 시각이 안 붙은 상태로 끝날 수 있다. 실측: 모바일
 * 캡처의 마지막 메시지가 마지막 시각보다 144px 아래에 있었다. 그렇다고 너무
 * 늘리면 입력창 위로 비치는 다음 화면(오버레이)이 들어온다.
 */
export const BOTTOM_MARGIN = 5

/* ------------------------------ 열 정렬 ------------------------------ */

/**
 * 말풍선이 붙는 세로 열의 허용 오차 — 화면 폭에 비례.
 *
 * PC 카톡은 이름 라벨이 본문보다 26px 왼쪽에서 시작한다. 이 오차 안에
 * 들어와야 이름 라벨이 살아남고, 그래야 단톡 감지가 동작한다.
 */
export function columnTolerance(width: number): number {
  return Math.max(20, width * 0.05)
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN
  return [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
}

/**
 * 열의 위치 — **중앙값이 아니라 가장 조밀한 무리의 중앙값**이다.
 *
 * 중앙값은 UI 잔재에 끌려간다. 실측(1206×2622): '나' 쪽 x1이
 * `675(헤더) 793(날짜) 940 947 1008 1021(배터리) 1107 1148 1153 1161` 이었고
 * 중앙값은 **1021**로 나왔다. 진짜 열은 1150 부근인데, `x1 ≤ 열+허용` 규칙이
 * 1081을 상한으로 잡아 **내 메시지 두 개가 통째로 잘려나갔다**.
 *
 * 말풍선은 같은 열에 여러 줄이 겹쳐 쌓인다 — 그게 다른 무엇보다 조밀하다.
 * 그 성질로 찾으면 잡음이 몇 개 섞여도 열이 밀리지 않는다.
 */
export function columnOf(values: number[], tol: number): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)

  let best: number[] = []
  for (let i = 0; i < sorted.length; i++) {
    const group = sorted.filter((v) => v >= sorted[i] && v <= sorted[i] + tol)
    // 동수면 뒤쪽(오른쪽) 무리를 택한다 — 잡음은 대개 열보다 안쪽에 있다
    if (group.length >= best.length) best = group
  }
  return median(best)
}

/**
 * 대화 말풍선은 딱 두 개의 세로 열에 붙는다 — 왼쪽 시작선과 오른쪽 끝선.
 *
 * 상태바·헤더·툴바는 그 열에 안 맞는다. 실측으로 `10:02`(상태바 시각),
 * `306`(뒤로가기), `LTE`, 헤더 이름, `카카오톡 선물하기`(오버레이)가 걸러졌다.
 *
 * **스티커 안의 글자도 여기서 걸린다** — 그림 속 문구는 말풍선 열에 안 맞는다.
 */
export function columnFilter(lines: OcrLine[], width: number, height_?: number): OcrLine[] {
  const tol = columnTolerance(width)
  // 상단 UI 영역에서는 양쪽 모두 엄격하게 본다. 멀티라인 때문에 오른쪽을
  // 느슨하게 뒀더니 상단 오버레이 배너가 '나'의 말풍선으로 새어 들어왔다
  // (실측: `카카오톡 선물하기`).
  const strictTop = height_ != null ? height_ * TOP_CHROME_RATIO : 0
  // 시각과 날짜는 말풍선 **안쪽**에 놓이므로 열에 안 맞는다. 걸러내면 안 된다.
  const structural = (l: OcrLine) => isTimeLabel(l.text) || isDateDivider(l.text)

  const body = lines.filter((l) => !structural(l))
  const leftCol = columnOf(
    body.filter((l) => sideOf(l.box, width) === 'other').map((l) => x0(l.box)),
    tol,
  )
  const rightCol = columnOf(
    body.filter((l) => sideOf(l.box, width) === 'me').map((l) => x1(l.box)),
    tol,
  )

  // 좌우를 다르게 본다.
  //
  // 말풍선 안의 글자는 **왼쪽 정렬**이다. 그래서
  // - '상대'(왼쪽 말풍선): 모든 줄이 같은 왼쪽 여백에서 시작 → **양방향**으로 본다
  // - '나'(오른쪽 말풍선): 짧은 줄은 오른쪽 끝선에 못 닿는다 → **넘지만 않으면** 된다
  //   (실측: "걱정되서 그래"가 45px 모자랐다)
  //
  // 왼쪽을 양방향으로 둬야 상단 오버레이 배너가 걸린다
  // (실측: `카카오톡 선물하기`가 x=414로 대화 열보다 232px 안쪽에 있었다).
  return lines.filter((l) => {
    if (structural(l)) return true
    if (sideOf(l.box, width) === 'other') {
      return Number.isNaN(leftCol) || Math.abs(x0(l.box) - leftCol) <= tol
    }
    if (Number.isNaN(rightCol)) return true
    if (cy(l.box) <= strictTop) return Math.abs(x1(l.box) - rightCol) <= tol
    return x1(l.box) <= rightCol + tol
  })
}

/** 화면 최상단 이 비율까지는 상태바·헤더가 섞일 수 있다 */
export const TOP_CHROME_RATIO = 0.12
/** 상단 영역에서 본문으로 인정하려면 이 비율 이상이 한글이어야 한다 */
export const HANGUL_MIN_RATIO = 0.5

const HANGUL = /[가-힣ㄱ-ㅎㅏ-ㅣ]/g

export function hangulRatio(text: string): number {
  const t = text.replace(/\s/g, '')
  if (t.length === 0) return 0
  return (t.match(HANGUL)?.length ?? 0) / t.length
}

/**
 * 상단 상태바·헤더의 잔재를 걷어낸다.
 *
 * 열 정렬만으로는 `LTE 18`, `Q & 생`처럼 우연히 오른쪽 끝선에 맞는 조각이 남는다.
 * 실측에서 이 둘이 '나'의 말풍선으로 잡혔다. 대화 최상단에 붙은 조각은
 * 한글 비중으로 한 번 더 거른다 — 렌더 캡처처럼 헤더가 없는 이미지는
 * 상단 내용이 한글이므로 영향을 받지 않는다.
 */
export function dropTopChrome(lines: OcrLine[], pageHeight: number): OcrLine[] {
  const limit = pageHeight * TOP_CHROME_RATIO
  return lines.filter((l) => {
    if (isTimeLabel(l.text) || isDateDivider(l.text)) return true
    if (cy(l.box) > limit) return true
    return hangulRatio(l.text) >= HANGUL_MIN_RATIO
  })
}

/** 본문 글자 높이의 이 배수를 넘으면 스티커 안의 글자로 본다 */
export const STICKER_TEXT_RATIO = 1.8

/**
 * 그림 속 글자를 걸러낸다.
 *
 * 카카오 스티커에는 문구가 그려져 있는 경우가 많다(실측: `쿼카칵!`).
 * OCR은 말풍선 안팎을 구분하지 못하지만, 스티커 문구는 본문보다 훨씬 크다.
 */
export function dropOversized(lines: OcrLine[]): OcrLine[] {
  const bodies = lines.filter((l) => !isTimeLabel(l.text))
  const med = median(bodies.map((l) => height(l.box)))
  if (!Number.isFinite(med) || med === 0) return lines
  return lines.filter(
    (l) => isTimeLabel(l.text) || height(l.box) <= med * STICKER_TEXT_RATIO,
  )
}

export function isTimeLabel(text: string): boolean {
  return TIME_LABEL.test(text.trim())
}

export function isDateDivider(text: string): boolean {
  return DATE_DIVIDER.test(text.trim())
}

/** `오전 10:23` → `10:23` (24시 정규화). 자정 12시대가 실제 캡처에 존재한다 */
export function parseTimeLabel(text: string): string | null {
  const m = TIME_LABEL.exec(text.trim())
  if (!m) return null
  const h = to24h(m[1], m[2])
  return `${String(h).padStart(2, '0')}:${m[3]}`
}

export function parseDateDivider(text: string): string | null {
  const m = DATE_DIVIDER.exec(text.trim())
  if (!m) return null
  const pad = (s: string) => s.padStart(2, '0')
  return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
}

/* ------------------------------ 좌우 판정 ------------------------------ */

/**
 * 말풍선의 정렬 방향.
 *
 * 중심 비교가 아니라 **가장자리까지의 거리**를 비교한다. 긴 메시지는 폭이 넓어
 * 중심이 화면 중앙 근처로 오지만, 붙어 있는 가장자리는 바뀌지 않는다.
 */
export function sideOf(box: Box, screenWidth: number): Who {
  const distLeft = x0(box)
  const distRight = screenWidth - x1(box)
  return distRight < distLeft ? 'me' : 'other'
}

/* ------------------------------ 이름 라벨 ------------------------------ */

/** 이름 라벨로 보기 위한 최대 글자 수 */
export const NAME_MAX_LEN = 12

/**
 * 발신자 이름 라벨을 찾는다.
 *
 * 카톡은 상대 말풍선 위에 이름을 작은 글씨로 반복 표시한다. OCR은 이걸
 * 메시지로 읽으므로 걸러야 한다. 동시에 **이것이 단톡을 감지하는 유일한 신호**다.
 *
 * 판정: (1) 짧고 (2) 2회 이상 반복되고 (3) 말풍선보다 작은 글씨
 */
export function detectNameLabels(page: OcrPage): Set<string> {
  const counts = new Map<string, OcrLine[]>()
  for (const l of page.lines) {
    const t = l.text.trim()
    if (t.length === 0 || t.length > NAME_MAX_LEN) continue
    if (isTimeLabel(t) || isDateDivider(t) || isUiChrome(t)) continue
    const cur = counts.get(t)
    if (cur) cur.push(l)
    else counts.set(t, [l])
  }

  // 내 쪽 줄들의 y 위치 — 이름 라벨 사이에 화자 교대가 있었는지 보는 데 쓴다
  const mineY = page.lines
    .filter((l) => !isTimeLabel(l.text) && sideOf(l.box, page.width) === 'me')
    .map((l) => cy(l.box))

  const out = new Set<string>()
  for (const [text, lines] of counts) {
    if (lines.length < 2) continue

    // 이름 라벨은 상대 쪽에만 붙는다
    if (!lines.every((l) => sideOf(l.box, page.width) === 'other')) continue

    // 버스트가 바뀔 때만 다시 표시되므로, 등장 사이에 내 메시지가 끼어 있다.
    // 상대가 같은 짧은 말("ㅇㅇ")을 연달아 두 번 한 경우와 이걸로 가른다.
    const ys = lines.map((l) => cy(l.box)).sort((a, b) => a - b)
    const alternated = ys.some((y, i) =>
      i > 0 ? mineY.some((m) => m > ys[i - 1] && m < y) : false,
    )
    if (!alternated) continue

    out.add(text)
  }
  return out
}

/**
 * 화자 수 — 3 이상이면 단톡이므로 거절한다(PRD §5).
 *
 * 이름을 **세기만 하고 보관하지 않는다**(§7.2 이름 미수집).
 */
export function countSpeakers(page: OcrPage): number {
  const names = detectNameLabels({
    ...page,
    lines: prepareLines(page),
  })
  const hasMine = page.lines.some(
    (l) => sideOf(l.box, page.width) === 'me' && !isTimeLabel(l.text),
  )
  return names.size + (hasMine ? 1 : 0)
}

/* ------------------------------ 말풍선 묶기 ------------------------------ */

export type Bubble = {
  who: Who
  lines: OcrLine[]
  box: Box
  time: string | null
  date: string | null
}

/**
 * 같은 말풍선으로 볼 세로 간격 — 글자 높이 배수.
 *
 * ⚠️ **실물 캡처로 반드시 튜닝해야 하는 값이다.** 한 말풍선 안의 줄 간격은
 * 좁고(≈0.2), 연속 발화로 나뉜 말풍선 사이는 넓다(≈0.6). 그 사이에 선을 긋는데,
 * 해상도·DPI·폰트 크기에 따라 달라진다. 기본값은 보수적으로 잡았다.
 */
export const LINE_GAP_RATIO = 0.35
/** 같은 말풍선으로 볼 좌측 정렬 오차(px) */
export const ALIGN_TOLERANCE = 12
/**
 * 시각 라벨이 같은 줄로 인정되는 세로 오차.
 *
 * 고정 px로 두면 해상도가 큰 캡처에서 어긋난다 — 실측: 모바일에서 1px 차이로
 * 시각이 말풍선에 안 붙었다. 글자 높이에 비례시킨다.
 */
export function timeRowTolerance(labelHeight: number): number {
  return Math.max(8, labelHeight * 0.6)
}

/**
 * 텍스트 줄을 말풍선 단위로 묶는다.
 *
 * OCR은 줄 단위로 bbox를 주므로, 멀티라인 메시지가 여러 줄로 쪼개져 나온다.
 * 같은 화자 + 세로로 인접 + 좌측 정렬이 같으면 한 말풍선으로 본다.
 */
/** 같은 줄로 볼 세로 겹침 비율 */
export const ROW_OVERLAP = 0.5
/** 같은 줄에서 이어붙일 가로 간격 — 글자 높이 배수 */
export const ROW_GAP_RATIO = 1.2

/**
 * 한 줄이 여러 조각으로 쪼개진 것을 다시 잇는다.
 *
 * OCR은 대비가 낮거나 글자 간격이 넓으면 한 줄을 여러 박스로 나눠 내놓는다.
 * 실측: 다크모드에서 "내일 일찍 나가야 해서"가 4조각으로 나왔다.
 *
 * **시각 라벨은 병합 대상에서 제외한다** — 말풍선과 같은 줄에 있어서
 * 같이 묶으면 본문에 시각이 붙어버린다.
 */
export function mergeRowFragments(lines: OcrLine[], screenWidth: number): OcrLine[] {
  const times = lines.filter((l) => isTimeLabel(l.text))
  const body = lines
    .filter((l) => !isTimeLabel(l.text))
    .sort((a, b) => y0(a.box) - y0(b.box) || x0(a.box) - x0(b.box))

  const rows: OcrLine[][] = []
  for (const l of body) {
    const row = rows[rows.length - 1]
    const prev = row?.[row.length - 1]
    const overlap =
      prev == null
        ? 0
        : Math.max(0, Math.min(y1(l.box), y1(prev.box)) - Math.max(y0(l.box), y0(prev.box)))
    const sameRow =
      prev != null &&
      overlap >= Math.min(height(l.box), height(prev.box)) * ROW_OVERLAP &&
      sideOf(l.box, screenWidth) === sideOf(prev.box, screenWidth)
    if (sameRow) row.push(l)
    else rows.push([l])
  }

  const merged: OcrLine[] = []
  for (const row of rows) {
    const sorted = [...row].sort((a, b) => x0(a.box) - x0(b.box))
    let cur = sorted[0]
    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i]
      const gap = x0(next.box) - x1(cur.box)
      if (gap <= height(cur.box) * ROW_GAP_RATIO) {
        cur = {
          text: `${cur.text} ${next.text}`.replace(/\s+/g, ' ').trim(),
          box: [
            Math.min(x0(cur.box), x0(next.box)),
            Math.min(y0(cur.box), y0(next.box)),
            Math.max(x1(cur.box), x1(next.box)),
            Math.max(y1(cur.box), y1(next.box)),
          ],
          confidence: Math.min(cur.confidence, next.confidence),
        }
      } else {
        merged.push(cur)
        cur = next
      }
    }
    merged.push(cur)
  }

  return [...merged, ...times].sort((a, b) => y0(a.box) - y0(b.box) || x0(a.box) - x0(b.box))
}

/**
 * OCR 원시 줄 → 대화 내용만 남긴 줄.
 *
 * 순서가 중요하다.
 * 1) 조각난 줄을 잇는다 — 안 이으면 조각마다 x가 달라 열 정렬이 깨진다
 * 2) UI 아이콘 한 글자를 버린다 — 열에 맞아버려서 2)로는 안 걸린다
 * 3) 말풍선 열에 안 맞는 것을 버린다 (헤더·상태바·오버레이·스티커 문구)
 * 4) 지나치게 큰 글자를 버린다 (그림 속 문구)
 * 5) 상단에 남은 UI 잔재를 한글 비중으로 거른다
 */
export function prepareLines(page: OcrPage): OcrLine[] {
  return dropTopChrome(
    dropOversized(
      columnFilter(
        mergeRowFragments(page.lines, page.width).filter((l) => !isUiGlyph(l.text)),
        page.width,
        page.height,
      ),
    ),
    page.height,
  )
}

export function groupBubbles(page: OcrPage): Bubble[] {
  const lines = prepareLines(page)
  const names = detectNameLabels({ ...page, lines })
  const [topLimit, bottomLimit] = contentBand(page)

  const body: OcrLine[] = []
  const times: OcrLine[] = []
  let currentDate: string | null = null
  const dateAt: Array<{ y: number; date: string }> = []

  for (const l of lines) {
    const t = l.text.trim()
    if (t.length === 0) continue
    if (isUiChrome(t)) continue
    // 날짜 구분선은 정규식이 엄격해서 오탐이 없다. 첫 시각보다 위에 있을 수
    // 있으므로 대화 영역 판정보다 먼저 처리한다.
    if (isDateDivider(t)) {
      const d = parseDateDivider(t)
      if (d) dateAt.push({ y: cy(l.box), date: d })
      continue
    }
    if (cy(l.box) < topLimit || cy(l.box) > bottomLimit) continue
    if (isTimeLabel(t)) {
      times.push(l)
      continue
    }
    if (names.has(t)) continue // 발신자 이름 라벨 — 세고 버린다
    body.push(l)
  }

  const bubbles: Bubble[] = []
  for (const l of body) {
    const who = sideOf(l.box, page.width)
    const last = bubbles[bubbles.length - 1]
    const gapOk =
      last != null &&
      last.who === who &&
      y0(l.box) - y1(last.box) <= height(l.box) * LINE_GAP_RATIO &&
      Math.abs(x0(l.box) - x0(last.box)) <= ALIGN_TOLERANCE

    if (gapOk) {
      last.lines.push(l)
      last.box = [
        Math.min(x0(last.box), x0(l.box)),
        Math.min(y0(last.box), y0(l.box)),
        Math.max(x1(last.box), x1(l.box)),
        Math.max(y1(last.box), y1(l.box)),
      ]
    } else {
      bubbles.push({ who, lines: [l], box: [...l.box] as Box, time: null, date: null })
    }
  }

  // 시각 라벨을 말풍선에 붙인다.
  //
  // "가장 가까운 것"으로 붙이면 안 된다 — 스티커처럼 OCR에 안 잡히는 요소의
  // 시각이 아래 말풍선에 흡수되어 비텍스트 구간을 놓친다. 카톡은 시각을
  // 말풍선과 **같은 줄에** 놓으므로, 세로 범위에 들어올 때만 붙인다.
  for (const t of times) {
    const parsed = parseTimeLabel(t.text)
    if (!parsed) continue
    const ty = cy(t.box)
    const tol = timeRowTolerance(height(t.box))
    for (const b of bubbles) {
      if (b.time) continue
      if (ty >= y0(b.box) - tol && ty <= y1(b.box) + tol) {
        b.time = parsed
        break
      }
    }
  }

  // 날짜 구분선 아래의 말풍선에 날짜를 물린다
  for (const b of bubbles) {
    currentDate = null
    for (const d of dateAt) if (d.y < y0(b.box)) currentDate = d.date
    b.date = currentDate
  }

  return bubbles
}

/* ------------------------------ Msg 변환 ------------------------------ */

export type OcrResult = {
  messages: Msg[]
  speakers: number
  /** 단톡이면 지표를 만들지 않는다 */
  rejected: 'group_chat' | null
  gaps: string[]
}

/** 비텍스트 요소가 있을 만한 세로 빈 구간 — VLM 크롭 대상 */
export type Hole = {
  who: Who
  /**
   * Vision에 보낼 세로 구간. **글자 줄이 하나도 안 걸리도록 좁혀 둔 값이다.**
   *
   * `/crop`은 가로 전체를 자르므로, 구간에 이름표나 본문 줄이 걸리면 그대로
   * 외부로 나간다 — MODELS §2.2가 "대화 글자가 나가지 않는다"고 적어둔 것과
   * 어긋난다. 실측(mom_01~03): 구간 3개 중 2개에 글자가 동봉됐고, 그중 하나는
   * 본문 한 줄 통째였다. `trimBand`가 이 경계를 강제한다.
   */
  y: [number, number]
  time: string | null
  /** 앞뒤 말풍선의 화자가 갈리면 낮춘다 */
  confidence: number
}

/** 이보다 얇아지면 스티커가 들어갈 자리가 아니다 — 구간을 버린다 */
export const MIN_HOLE_HEIGHT = 40

/**
 * 화면 가장자리 구간의 최소 높이 — **글자 줄 높이의 배수**.
 *
 * 가장자리는 앞뒤 말풍선으로 여백을 견줄 수 없어 크기로만 판단한다.
 * 절대 픽셀은 해상도를 못 따라간다.
 */
export const EDGE_HOLE_LINES = 3

/**
 * 시각 라벨 하나만 보고 비텍스트 발화의 화자를 정한다.
 *
 * **카톡은 시각을 말풍선 안쪽 가장자리에 놓는다** — 오른쪽(내) 말풍선이면
 * 시각이 왼쪽에, 왼쪽(상대) 말풍선이면 시각이 오른쪽에 붙는다. 그래서
 * `sideOf(시각)`을 그대로 쓰면 **반대로 나온다.** 실측(1206×2622)에서
 * 내가 보낸 사진이 상대 것으로 뒤집혔다.
 *
 * 대신 양쪽 가정의 **함의된 폭**을 견준다. 시각이 x237이고 상대 열이 182면
 * "상대가 보낸 55px짜리 발화"가 되는데, 그 발화의 높이가 1080px이다 —
 * 말이 안 된다. 내 것으로 보면 832×1080이라 사진으로 그럴듯하다.
 *
 * 글자 말풍선에는 못 쓴다(가로세로비가 자유롭다). 스티커·사진이 대체로
 * 정사각에 가깝다는 성질에 기대는 판정이다.
 */
export function sideOfNontext(
  timeBox: Box,
  bandHeight: number,
  leftMargin: number,
  rightMargin: number,
): Who {
  const asOther = x0(timeBox) - leftMargin
  const asMe = rightMargin - x1(timeBox)
  const off = (w: number) => (w > 0 ? Math.abs(Math.log(w / bandHeight)) : Infinity)
  return off(asMe) < off(asOther) ? 'me' : 'other'
}

/**
 * 구간에서 글자가 걸치는 부분을 잘라내고 **가장 큰 빈 조각**만 남긴다.
 *
 * 중심이 아니라 **상자 전체**로 판정한다. 중심만 보면 구간 경계에 반쯤 걸친
 * 이름표가 통과해 조각 위쪽에 그대로 찍힌다.
 */
export function trimBand(
  band: [number, number],
  lines: OcrLine[],
  pad = 2,
): [number, number] | null {
  const blockers = lines
    // UI 아이콘은 지킬 글자가 아니다. 남겨두면 **조각을 반으로 가른다** —
    // 실측: 사진 위에 겹쳐 있는 `↑`(공유 버튼)가 사진을 위/아래로 쪼갰고,
    // 큰 쪽이 하필 벽면뿐인 위쪽이라 Vision이 "판독 불가"를 냈다.
    .filter((l) => !isUiGlyph(l.text))
    .filter((l) => l.box[3] > band[0] && l.box[1] < band[1])
    .map((l): [number, number] => [l.box[1] - pad, l.box[3] + pad])
    .sort((a, b) => a[0] - b[0])

  let best: [number, number] | null = null
  let cursor = band[0]
  const consider = (a: number, b: number) => {
    if (b - a > (best ? best[1] - best[0] : 0)) best = [a, b]
  }

  for (const [a, b] of blockers) {
    if (a > cursor) consider(cursor, Math.min(a, band[1]))
    cursor = Math.max(cursor, b)
  }
  if (cursor < band[1]) consider(cursor, band[1])

  if (!best) return null
  const [a, b] = best as [number, number]
  return b - a >= MIN_HOLE_HEIGHT ? [Math.round(a), Math.round(b)] : null
}

/**
 * 말풍선 사이 여백이 이 배수를 넘으면 비텍스트 발화로 본다.
 *
 * 고아 시각은 주 단서가 될 수 없다 — 카톡은 같은 분에 연달아 보낸 발화의
 * **마지막에만** 시각을 붙이므로, 버스트 안에 낀 스티커는 시각을 갖지 않는다.
 * 실측: PC 캡처의 사진이 정확히 그 경우였다.
 */
export const HOLE_GAP_RATIO = 2.2

/**
 * 비텍스트 발화를 찾는다.
 *
 * **여백이 주 단서다.** 스티커·사진은 글자가 없어 OCR에 안 잡히지만 화면에서
 * 자리를 차지하므로, 말풍선 사이가 비정상적으로 벌어진다.
 *
 * 고아 시각은 보조일 뿐이다 — 카톡은 같은 분에 연달아 보낸 발화의 마지막에만
 * 시각을 붙이므로, 버스트 안에 낀 스티커에는 시각이 없다.
 */
export function findHoles(page: OcrPage, bubbles: Bubble[]): Hole[] {
  if (bubbles.length < 2) return []

  const sorted = [...bubbles].sort((a, b) => y0(a.box) - y0(b.box))
  const gaps = sorted.slice(1).map((b, i) => y0(b.box) - y1(sorted[i].box))
  const normal = median(gaps.filter((g) => g >= 0))
  if (!Number.isFinite(normal) || normal <= 0) return []

  // 어느 말풍선에도 못 붙은 시각 — 여백의 시각을 보강한다
  const usedTimes = new Set(bubbles.map((b) => b.time).filter(Boolean) as string[])
  const orphans = dropOutlierTimes(page.lines.filter((l) => isTimeLabel(l.text)))
    .map((l) => ({ box: l.box, time: parseTimeLabel(l.text) }))
    .filter((o) => o.time != null && !usedTimes.has(o.time))

  const holes: Hole[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const next = sorted[i]
    const band: [number, number] = [y1(prev.box), y0(next.box)]
    if (band[1] - band[0] <= normal * HOLE_GAP_RATIO) continue

    const orphan = orphans.find((o) => cy(o.box) > band[0] && cy(o.box) < band[1])

    // 시각 판정은 **자르기 전 구간**으로 한다 — 고아 시각 자체가 글자라서
    // 좁힌 구간에서는 항상 빠진다.
    const safe = trimBand(band, page.lines)
    if (!safe) continue

    // 판정은 **자른 뒤 높이**로 다시 한다. 날짜 구분선이 끼면 여백이 부풀어
    // 실제로는 빈 자리가 없는데도 발화로 잡힌다(실측: mom_01의 48px 헛구간).
    // 정작 중요한 건 "글자를 뺀 빈 자리가 말풍선 하나만큼 되는가"다.
    if (safe[1] - safe[0] <= normal * HOLE_GAP_RATIO) continue

    // 스티커는 버스트 안에 낀다. 앞뒤 화자가 같으면 그 화자로 확정하고,
    // 갈리면 뒤쪽을 따르되 신뢰도를 낮춘다(새 버스트의 첫 발화일 수 있다).
    const agree = prev.who === next.who
    holes.push({
      who: agree ? prev.who : next.who,
      y: safe,
      time: orphan?.time ?? null,
      confidence: agree ? 0.8 : 0.5,
    })
  }

  // 첫 말풍선 **위**와 마지막 말풍선 **아래**도 본다.
  //
  // 여백 비교는 앞뒤 말풍선이 있어야 성립한다. 그런데 화면 맨 위가 사진이면
  // 비교 상대가 없다 — 실측(1206×2622)에서 큰 사진 하나가 통째로 안 잡혔다.
  //
  // 화자는 **고아 시각이 어느 쪽에 붙어 있는지**로 정한다(`sideOfNontext`).
  // 시각이 없으면 **추가하지 않는다** — 화자를 모르는 발화는 비대칭을 오염시킨다.
  //
  // 위 경계는 0에서 시작해 `trimBand`가 알아서 헤더 아래로 밀어낸다.
  // 고정 비율(TOP_CHROME_RATIO)로 바닥을 깔면 **사진 윗부분이 잘린다** —
  // 실측(1206×2622)에서 사진이 y250에서 시작하는데 12% 바닥이 315라 65px을
  // 날렸다. 헤더가 구간에 섞이는 문제는 아래 `edgeMin`과 고아 시각 요구로 막는다.
  const [topLimit, bottomLimit] = contentBand(page)
  const edges: Array<[number, number]> = [
    [topLimit, y0(sorted[0].box)],
    [y1(sorted[sorted.length - 1].box), bottomLimit],
  ]

  // 가장자리에는 여백 비교 상대가 없으니 **크기**로 거른다. 스티커·사진은 글자
  // 몇 줄보다 크다. 절대 픽셀로 두면 해상도를 못 따라간다 — 620폭에서 적당한
  // 값이 1206폭에서는 날짜 구분선 아래 여백까지 발화로 만든다(실측 48px 헛구간).
  const lineH = median(page.lines.map((l) => height(l.box)))
  const edgeMin = Number.isFinite(lineH) ? lineH * EDGE_HOLE_LINES : MIN_HOLE_HEIGHT

  // 여백은 **확정된 말풍선**에서 읽는다 — 열 재검출보다 잡음이 없다
  const otherX = sorted.filter((b) => b.who === 'other').map((b) => x0(b.box))
  const meX = sorted.filter((b) => b.who === 'me').map((b) => x1(b.box))
  const leftMargin = otherX.length ? Math.min(...otherX) : 0
  const rightMargin = meX.length ? Math.max(...meX) : page.width

  for (const band of edges) {
    if (band[1] - band[0] <= Math.max(normal * HOLE_GAP_RATIO, edgeMin)) continue
    const orphan = orphans.find((o) => cy(o.box) > band[0] && cy(o.box) < band[1])
    if (!orphan?.time) continue
    const safe = trimBand(band, page.lines)
    if (!safe || safe[1] - safe[0] < edgeMin) continue
    holes.push({
      who: sideOfNontext(orphan.box, safe[1] - safe[0], leftMargin, rightMargin),
      y: safe,
      time: orphan.time,
      // 앞뒤 화자로 교차 확인할 수 없다 — 시각 위치 하나에만 기댄다
      confidence: 0.5,
    })
  }

  return holes.sort((a, b) => a.y[0] - b.y[0])
}

/* ------------------------------ 겹침 제거 ------------------------------ */

/** 큰 겹침부터 시도한다. 5는 실제 스크롤 겹침(6~10개)을 못 잡는다 — SPEC §4.2 */
export const MAX_OVERLAP = 15
/** 단건 일치로 병합하지 않는다 */
export const MIN_OVERLAP = 2

/**
 * 비교 키 — `(who, text, time)` 튜플.
 *
 * 텍스트만 비교하면 `ㅇㅇ`·`ㅋㅋ`가 오매칭된다. 비텍스트 발화는 본문이 없으므로
 * 타입과 시각으로 구분한다.
 */
export function messageKey(m: Msg): string {
  const body = m.text?.trim().replace(/\s+/g, ' ') ?? `#${m.type}`
  return `${m.who} ${body} ${m.time ?? ''}`
}

function equalRun(a: Msg[], b: Msg[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (messageKey(a[i]) !== messageKey(b[i])) return false
  }
  return true
}

/** a의 꼬리와 b의 머리가 몇 건 겹치는가. 0이면 안 겹친다 */
export function overlapOf(a: Msg[], b: Msg[]): number {
  const max = Math.min(MAX_OVERLAP, a.length, b.length)
  for (let k = max; k >= MIN_OVERLAP; k--) {
    if (equalRun(a.slice(-k), b.slice(0, k))) return k
  }
  return 0
}

export type OrderResult = {
  /** 원본 배열에 대한 인덱스 순서 */
  order: number[]
  /** 이 순서로 이었을 때 겹침 총합 */
  score: number
  /** 사용자가 넣은 순서와 달라졌는가 */
  reordered: boolean
}

/** 전수 탐색을 포기하는 장수 — 그 위로는 탐욕법으로 잇는다 */
export const ORDER_EXHAUSTIVE_MAX = 8

/**
 * 캡처를 **겹침으로 다시 세운다** — SPEC §4.2
 *
 * 캡처에는 `ts`가 없다. 시간축으로 되돌릴 수단이 없으니 순서가 곧 결과인데,
 * 사용자가 파일을 고르는 순서는 믿을 게 못 된다(파일 탐색기 정렬, 다중 선택
 * 순서 등). 실측: 겹치게 찍은 2장을 뒤집어 넣으면 겹친 4건이 중복으로 남아
 * 20건이 됐다.
 *
 * 그래서 **겹치는 쌍을 찾아 사슬로 잇는다.** 스크롤 캡처는 앞 장의 꼬리와
 * 뒷 장의 머리가 같으므로, 그 관계가 순서를 알려준다.
 *
 * **겹침이 하나도 없으면 손대지 않는다.** 따로 찍은 캡처는 순서를 알 수단이
 * 없고, 그때 임의로 재배열하면 없는 근거로 결과를 바꾸는 것이 된다.
 */
export function orderPages(pages: Msg[][]): OrderResult {
  const n = pages.length
  const identity = { order: pages.map((_, i) => i), score: 0, reordered: false }
  if (n < 2) return identity

  // 모든 방향쌍의 겹침을 미리 재둔다
  const ov: number[][] = pages.map((a, i) => pages.map((b, j) => (i === j ? 0 : overlapOf(a, b))))
  const total = ov.flat().reduce((s, v) => s + v, 0)
  if (total === 0) return identity // 겹침이 없다 — 알 방법이 없으니 그대로 둔다

  const scoreOf = (o: number[]) => o.slice(1).reduce((s, cur, k) => s + ov[o[k]][cur], 0)
  const given = pages.map((_, i) => i)

  let best = given
  let bestScore = scoreOf(given)

  if (n <= ORDER_EXHAUSTIVE_MAX) {
    // 8장이면 40320가지. 겹침은 미리 재뒀으므로 순열당 7번만 더하면 된다.
    const perm = (rest: number[], acc: number[]) => {
      if (rest.length === 0) {
        const s = scoreOf(acc)
        if (s > bestScore) {
          bestScore = s
          best = [...acc]
        }
        return
      }
      for (let i = 0; i < rest.length; i++) {
        perm([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, rest[i]])
      }
    }
    perm(given, [])
  } else {
    // 장수가 많으면 전수는 못 돈다. 가장 세게 겹치는 쌍부터 이어 붙인다.
    let start = 0
    let bestHead = -1
    for (let i = 0; i < n; i++) {
      // 아무도 앞에 오지 않는 장(들어오는 겹침이 가장 약한 장)이 머리다
      const incoming = Math.max(...pages.map((_, j) => (j === i ? 0 : ov[j][i])))
      if (bestHead === -1 || incoming < bestHead) {
        bestHead = incoming
        start = i
      }
    }
    const chain = [start]
    const left = new Set(given.filter((i) => i !== start))
    while (left.size) {
      const tail = chain[chain.length - 1]
      let pick = -1
      let pickOv = -1
      for (const j of left) {
        if (ov[tail][j] > pickOv) {
          pickOv = ov[tail][j]
          pick = j
        }
      }
      chain.push(pick)
      left.delete(pick)
    }
    if (scoreOf(chain) > bestScore) {
      best = chain
      bestScore = scoreOf(chain)
    }
  }

  return {
    order: best,
    score: bestScore,
    reordered: best.some((v, i) => v !== i),
  }
}

export type MergeReport = {
  messages: Msg[]
  /** 이미지별 제거된 중복 개수 */
  removed: number[]
  gaps: string[]
}

/**
 * 스크롤하며 겹치게 찍은 캡처들을 이어 붙인다 — SPEC §4.2
 *
 * **지표 계산 전 단계에서 반드시 처리한다.** 안 하면 겹친 구간이 두 번 세어져
 * 메시지수 비대칭이 통째로 왜곡된다.
 *
 * 이것은 모델이 아니라 알고리즘이다(MODELS §7).
 */
export function mergeMessages(pages: Msg[][], labels?: string[]): MergeReport {
  const removed: number[] = []
  const gaps: string[] = []
  let acc: Msg[] = pages[0] ?? []

  for (let i = 1; i < pages.length; i++) {
    const next = pages[i]
    const max = Math.min(MAX_OVERLAP, acc.length, next.length)
    let overlap = 0
    for (let k = max; k >= MIN_OVERLAP; k--) {
      if (equalRun(acc.slice(-k), next.slice(0, k))) {
        overlap = k
        break
      }
    }
    if (overlap === 0) gaps.push(`scroll_break:${labels?.[i] ?? `img${i + 1}`}`)
    removed.push(overlap)
    acc = [...acc, ...next.slice(overlap)]
  }

  return {
    messages: acc.map((m, seq) => ({ ...m, seq })),
    removed,
    gaps,
  }
}

export function toMessages(page: OcrPage): OcrResult {
  const speakers = countSpeakers(page)
  const gaps: string[] = []

  if (speakers >= 3) {
    return { messages: [], speakers, rejected: 'group_chat', gaps }
  }

  const bubbles = groupBubbles(page)
  const holes = findHoles(page, bubbles)
  if (holes.length > 0) gaps.push(`nontext_regions:${holes.length}`)

  // 말풍선과 비텍스트 발화를 **하나의 시간축에 섞어** 정렬한다.
  // 비텍스트를 빼고 만들면 앞뒤 메시지가 한 버스트로 잘못 합쳐진다.
  type Item = { top: number; msg: Omit<Msg, 'seq'> }
  const items: Item[] = []

  for (const b of bubbles) {
    const text = b.lines.map((l) => l.text.trim()).join('\n')
    items.push({
      top: b.box[1],
      msg: {
        who: b.who,
        ts: null,
        date: b.date,
        time: b.time,
        type: 'text' as MsgType,
        text,
        charCount: countableLength(text),
        emojiDesc: null,
        affect: null,
        confidence: Math.min(...b.lines.map((l) => l.confidence)),
      },
    })
  }

  for (const h of holes) {
    // 날짜는 바로 앞 말풍선에서 물려받는다 — 구분선은 그 위에 있다
    const before = bubbles
      .filter((b) => b.box[1] < h.y[0])
      .sort((a, b) => b.box[1] - a.box[1])[0]
    items.push({
      top: h.y[0],
      msg: {
        who: h.who,
        ts: null,
        date: before?.date ?? null,
        time: h.time,
        type: 'nontext' as MsgType,
        text: null,
        charCount: 0,
        emojiDesc: null,
        affect: null,
        confidence: h.confidence,
      },
    })
  }

  items.sort((a, b) => a.top - b.top)
  const messages: Msg[] = items.map((it, seq) => ({ seq, ...it.msg }))

  return { messages, speakers, rejected: null, gaps }
}
