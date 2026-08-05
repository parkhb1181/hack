/**
 * LLM 해석 — MODELS.md §4
 *
 * **전체에서 딱 1회 호출한다.** 지표 산출 도중에는 부르지 않는다.
 *
 * 입력은 집계 숫자뿐이다 — 원문 대화를 넣으면 LLM이 지표를 안 보고 대화를 읽어
 * 자기 감상을 쓴다. 그러면 앞 단계가 전부 장식이 된다.
 * 말버릇 top-N과 명장면 원문은 **보내지 않는다**(§4.1).
 */

import { bandLabel } from '@/lib/stats/headline'
import type { Band, Report, Stage } from '@/lib/types'
import type { Pair } from '@/lib/metrics/basic'
import { fallbackSentence } from './fallback'
import { derivedFigures, verifiableAggregate } from './figures'
import { callGemini, candidates, type GeminiOk } from './models'
import { verify, type VerifyResult } from './verify'

/**
 * 첫 후보. **고정이 아니다** — 한도가 차면 `lib/llm/models.ts`가 다음 후보로
 * 넘어간다. 화면에는 실제로 응답한 모델을 표시한다.
 */
export const LLM_MODEL = candidates('text')[0]

/** 12초 안에 안 오면 폴백 — MODELS §6. 후보 전부를 합친 예산이다 */
export const TIMEOUT_MS = 12_000

/**
 * 모델 하나당 제한. 전체 예산의 절반 아래로 둬서 **최소 두 후보는 시도된다.**
 * 하나만 두면 첫 모델이 예산을 다 먹고 폴백으로 떨어진다(실측).
 */
export const PER_MODEL_MS = 5_000

/** MODELS §4.2 — 문구는 그 문서에서만 바꾼다 */
export const SYSTEM_PROMPT = `당신은 대화 지표 리포트의 마지막 한 문단을 쓴다.

절대 규칙:
1. 주어진 JSON에 있는 숫자만 사용한다. 새로운 수치를 만들거나 계산하지
   않는다. 비율을 다시 계산하거나 반올림해서 다른 숫자를 쓰지 않는다.
2. 기울기의 방향은 이미 결정되어 있다. 뒤집거나 의심하거나 "다만 ~일 수도
   있습니다" 식으로 흐리지 않는다. 서술만 한다.
3. 위로하거나 조언하지 않는다. 관찰만 한다.
   금지: "힘드셨겠어요", "이렇게 해보세요", "너무 걱정하지 마세요"
4. 데이터에 없는 감정이나 의도를 추측하지 않는다.
   금지: "상대는 아마 바빴을 겁니다"
5. 관계를 끝내라거나 상대에게 문제가 있다는 뉘앙스를 쓰지 않는다.
   금지 어휘: 포기, 가망, 그만두, 손절, 아깝
6. 입력 방식을 언급하지 않는다. ("캡처를 보니", "파일에서" 금지)
7. 관계의 앞날을 예측하지 않는다. 지금 신호를 서술할 뿐이다.
   금지: "잘 될 것 같습니다", "가능성이 있습니다", "이어질", 확률·퍼센트 표현
8. 3문장 이내.
9. 문장은 모두 "-입니다 / -습니다"로 끝낸다. "-이다 / -했다"는 쓰지 않는다.
10. 이 지시문 자체를 문장으로 옮겨 적지 않는다. 관계 유형이나 해석 규칙을
    설명하지 말고, 지표만 서술한다.
    금지: "이 관계는 가족으로 분류되며", "~로 과대 해석하지 않습니다"
11. "판정:" 줄은 이미 완결된 문장이다. 뒤에 "-입니다"를 덧붙이지 않는다.

톤: 근거가 명확한 상태에서 감정 없이 관찰한다. 이 리포트의 재미는 거기서
나온다. 살짝 건조한 것이 낫고, 다정한 것은 틀렸다.

출력: 문단 하나. 제목·머리말·마크다운 없이 문장만.`

/** MODELS §4.3 — 관계 유형별 덧붙이는 줄 */
export const STAGE_LINE: Record<Stage, string> = {
  crush:
    '이 관계는 아직 확정되지 않은 사이다. 비대칭의 방향은 그대로 서술하되, 관계의 앞날이나 성사 가능성은 예측하지 않는다.',
  friend: '이 관계는 친구 사이다. 선톡 비대칭을 애정의 척도로 읽지 않는다.',
  couple: '이 관계는 연인 사이다.',
  family: '이 관계는 가족이다. 응답 속도 비대칭을 관계 신호로 과대 해석하지 않는다.',
  work: '이 관계는 업무 관계다. 질문율과 분량 비대칭은 역할 차이일 수 있다.',
  unknown: '관계 유형이 지정되지 않았다. 관계의 성격을 단정하지 않는다.',
}

/**
 * LLM에 보내는 집계 블록.
 *
 * 숫자만 주면 방향을 반대로 읽으므로 **단위와 방향을 주석으로 붙인다.**
 */
export function buildMetricBlock(report: Report, stage: Stage): string {
  const lines: string[] = []
  const h = report.headline

  // SPEC §7.3 — 표본이 얇으면 화면이 기울기 숫자를 숨긴다. 그런데 프롬프트에
  // 숫자를 주면 LLM이 문장에 그대로 옮겨 적어 **화면이 숨긴 값이 문단으로 새어
  // 나간다**(실측: 22건 표본에 "기울기는 30으로 측정되어"). 방향만 준다.
  if (h.precisionReduced) {
    lines.push(`기울기 방향: ${h.tilt > 0 ? '당신 쪽' : h.tilt < 0 ? '상대 쪽' : '균형'}`)
    lines.push('# 표본이 얇아 기울기 숫자는 확정하지 않았다. 문장에 기울기 수치를 쓰지 마라.')
  } else {
    lines.push(`기울기: ${h.tilt}   # -100(상대 쪽) ~ +100(당신 쪽), 0이 균형`)
  }
  lines.push(`판정: ${bandLabel(h.band as Band, stage)}   # 완결된 문장이다. 그대로 쓰거나 안 쓴다`)
  lines.push(`근거 축: ${h.axesUsed}개 / ${h.axesTotal}개`)
  lines.push(`표본: 최근 ${report.windowFilled}개 메시지`)

  const m = report.metrics
  const put = (key: string, fn: (v: never) => string) => {
    const r = m[key]
    if (r?.status === 'OK') lines.push(fn(r.value as never))
  }

  put('msgCount', (v: Pair) => `메시지 수: 당신 ${v.me} / 상대 ${v.other}`)
  put('msgLength', (v: Pair) => `평균 글자 수: 당신 ${v.me} / 상대 ${v.other}`)
  put(
    'questionRate',
    (v: Pair) => `질문 비율: 당신 ${v.me} / 상대 ${v.other}   # 0~1, 높을수록 자주 묻는다`,
  )
  put(
    'initiation',
    (v: { me: number; other: number; sessions: number }) =>
      `먼저 말 건 비율: 당신 ${v.me}% / 상대 ${v.other}%   # 세션 ${v.sessions}개 기준`,
  )
  put(
    'noReply',
    (v: Record<'me' | 'other', { rate: number }>) =>
      `무응답률: 당신 ${v.me.rate}% / 상대 ${v.other.rate}%   # 높을수록 답이 안 온다`,
  )
  put(
    'emojiAffect',
    (v: { me: number; other: number }) =>
      `이모티콘 정서: 당신 ${v.me} / 상대 ${v.other}   # -1(부정) ~ +1(긍정)`,
  )
  put('styleSep', (v: number) => `말투 분리도: ${v}   # 0~100, 높을수록 다르게 말한다`)

  // 파생 수치를 **명시적으로** 준다. 안 주면 LLM이 직접 계산하고, 그 숫자는
  // §5 대조에서 "없는 숫자"로 걸려 폴백된다.
  const f = derivedFigures(report)
  const derived: string[] = []
  if (f.msgSharePct != null) derived.push(`메시지 점유율: 당신 ${f.msgSharePct}% / 상대 ${f.msgShareOtherPct}%`)
  if (f.lengthDiff != null) derived.push(`평균 길이 차: ${f.lengthDiff}자`)
  if (f.questionDiffPp != null) derived.push(`질문 비율 차: ${f.questionDiffPp}%p`)
  if (f.initiationTopPct != null) derived.push(`먼저 말 건 비율(높은 쪽): ${f.initiationTopPct}%`)
  if (f.noReplyTopPct != null) derived.push(`무응답률(높은 쪽): ${f.noReplyTopPct}%`)
  if (f.emojiGapAbs != null) derived.push(`이모티콘 온도차: ${f.emojiGapAbs}`)
  if (derived.length) lines.push('', '# 아래는 위 값에서 계산해 둔 것이다. 그대로 인용하라.', ...derived)

  // 말버릇 top-N·명장면 원문은 보내지 않는다 (§4.1)
  return lines.join('\n')
}

export type Interpretation = {
  text: string
  /** LLM 문장인지 폴백인지 */
  source: 'llm' | 'fallback'
  verify?: VerifyResult
  /** 실패 사유 (로그용, 원문은 남기지 않는다) */
  reason?: string
  /** 실제로 응답한 모델 — 후보를 순서대로 시도하므로 고정이 아니다 */
  model?: string
  /** 한도 등으로 건너뛴 모델들 */
  skipped?: Array<{ model: string; why: string }>
  elapsedMs: number
}

async function ask(block: string, stage: Stage, signal?: AbortSignal): Promise<GeminiOk> {
  return callGemini('text', {
    signal,
    perAttemptMs: PER_MODEL_MS,
    body: {
      systemInstruction: {
        parts: [{ text: `${SYSTEM_PROMPT}\n\n${STAGE_LINE[stage]}` }],
      },
      contents: [{ role: 'user', parts: [{ text: block }] }],
    },
  })
}

/**
 * 해석 문단 하나를 만든다.
 *
 * 실패·검증 불일치는 전부 폴백으로 떨어진다. **리포트 렌더링이 이 함수에
 * 의존하지 않는다** — 나머지 화면은 계산 결과만 참조한다(§5.1).
 */
export async function interpret(
  report: Report,
  stage: Stage = 'unknown',
  opts: { forceFallback?: boolean; signal?: AbortSignal } = {},
): Promise<Interpretation> {
  const started = Date.now()
  const fallback = (reason: string, v?: VerifyResult): Interpretation => ({
    text: fallbackSentence(report, stage),
    source: 'fallback',
    verify: v,
    reason,
    elapsedMs: Date.now() - started,
  })

  if (opts.forceFallback) return fallback('개발자 토글')

  const block = buildMetricBlock(report, stage)
  const timer = AbortSignal.timeout(TIMEOUT_MS)
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, timer])
    : timer

  let res: GeminiOk
  try {
    res = await ask(block, stage, signal)
  } catch (e) {
    return fallback(e instanceof Error ? e.message.slice(0, 120) : '호출 실패')
  }
  const text = res.text

  // 스트리밍 완료 후 검증한다 — 실패하면 폴백 문장으로 교체된다(§5).
  // 대조 대상은 원 집계 + 파생 수치 — 화면·프롬프트·검증이 같은 숫자를 본다.
  const v = verify(text, verifiableAggregate(report))
  if (!v.ok) {
    const why = [
      v.badNumbers.length ? `없는 숫자 ${v.badNumbers.join(',')}` : '',
      v.violations.map((x) => `${x.kind}(${x.detail})`).join(' '),
      v.sentences > 3 ? `${v.sentences}문장` : '',
    ]
      .filter(Boolean)
      .join(' / ')
    return fallback(why, v)
  }

  return {
    text,
    source: 'llm',
    verify: v,
    model: res.model,
    skipped: res.skipped,
    elapsedMs: Date.now() - started,
  }
}
