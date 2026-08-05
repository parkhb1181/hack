/**
 * LLM 응답 후검증 — MODELS.md §5
 *
 * > LLM 응답의 수치는 집계 결과와 대조 검증하며, 불일치 시 폴백한다.
 *
 * 프롬프트의 "주어진 숫자만 쓴다"는 지키다 말 수 있다. 대조는 못 어긴다.
 * **이 파일이 권한 경계를 코드로 강제하는 지점이다**(PRD §4.1).
 */

const NUM = /-?\d+(?:\.\d+)?/g

/** 서수·관사 성격이라 지표에 없어도 허용한다 */
export const WHITELIST = new Set(['0', '1', '2', '3'])

/**
 * 관계를 끝내라거나 사람에게 문제가 있다는 뉘앙스 — PRD §4.5 / MODELS §4.2
 */
export const BANNED_WORDS = ['포기', '가망', '그만두', '손절', '아깝']

/** 앞날을 예측하는 표현 — MODELS §4.2 규칙 7 */
export const BANNED_PREDICTION = [
  '이어질',
  '잘 될',
  '잘될',
  '가능성이',
  '확률',
  '전망',
]

/** 위로·조언 — MODELS §4.2 규칙 3 */
export const BANNED_ADVICE = [
  '힘드셨',
  '해보세요',
  '하세요',
  '추천',
  '걱정하지',
  '괜찮아질',
]

/**
 * 판독 창(최근 120개)으로 낸 값을 전체 대화처럼 말하면 표본을 오도한다.
 * plus의 "median 지표를 평균이라 쓰면 위반"과 같은 계열의 검사다.
 *
 * (우리는 SPEC §8.3에서 중앙값을 쓰지 않기로 했으므로 median 함정은 없다.)
 */
export const BANNED_SCOPE = ['평생', '항상', '한 번도', '단 한 번']

export type Violation = { kind: string; detail: string }

/** 집계 객체에서 숫자를 전부 긁는다 */
export function collectNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.push(value)
  } else if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, out)
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectNumbers(v, out)
  }
  return out
}

/** 한 숫자가 문장에 등장할 수 있는 표기들 */
function variants(v: number): string[] {
  return [
    String(v),
    String(Math.round(v)),
    String(Math.round(v * 100)),
    v.toFixed(1),
    String(Math.abs(Math.round(v))),
    String(Math.abs(v)),
  ]
}

export function allowedNumbers(aggregate: unknown): Set<string> {
  const out = new Set<string>()
  for (const v of collectNumbers(aggregate)) {
    for (const s of variants(v)) out.add(s)
  }
  return out
}

/**
 * 지표에 없는 숫자를 썼는지 본다.
 *
 * 불일치 토큰이 **1개라도** 있으면 폴백이다. 로그에는 원문이 아니라
 * 불일치 토큰만 남긴다(MODELS §5).
 */
export function verifyNumbers(
  text: string,
  aggregate: unknown,
): { ok: boolean; bad: string[] } {
  const allowed = allowedNumbers(aggregate)
  const found = text.match(NUM) ?? []
  const bad = found.filter((n) => !allowed.has(n) && !WHITELIST.has(n))
  return { ok: bad.length === 0, bad }
}

export function verifyWords(text: string): Violation[] {
  const out: Violation[] = []
  const check = (list: string[], kind: string) => {
    for (const w of list) if (text.includes(w)) out.push({ kind, detail: w })
  }
  check(BANNED_WORDS, '밀어내는 어휘')
  check(BANNED_PREDICTION, '앞날 예측')
  check(BANNED_ADVICE, '위로·조언')
  check(BANNED_SCOPE, '표본 오도')
  return out
}

/**
 * 두 문장 — MODELS §4.2.
 *
 * 세 문장을 허용하면 카드가 이미 말한 숫자를 다시 읽어주는 문단이 돌아온다
 * (실측). 그렇다고 하나로 못 박으면 드립의 두 박자가 잘린다 —
 * `물음표는 죄다 네 몫이네. 무슨 면접 보냐?`가 통째로 폴백됐다.
 * 치고 받는 데까지가 한 줄이고, 그 다음부터가 문단이다.
 */
export const MAX_SENTENCES = 2

export function countSentences(text: string): number {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean).length
}

export type VerifyResult = {
  ok: boolean
  badNumbers: string[]
  violations: Violation[]
  sentences: number
}

export function verify(text: string, aggregate: unknown): VerifyResult {
  const nums = verifyNumbers(text, aggregate)
  const violations = verifyWords(text)
  const sentences = countSentences(text)
  return {
    ok: nums.ok && violations.length === 0 && sentences <= MAX_SENTENCES,
    badNumbers: nums.bad,
    violations,
    sentences,
  }
}
