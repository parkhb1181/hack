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

/**
 * MODELS §4.2 — 문구는 그 문서에서만 바꾼다.
 *
 * **한 줄이다. 문단이 아니다.** 결과 화면은 숫자 카드가 주인공이고, 그 밑에
 * 붙는 한 줄이 "그래서 뭔데?"에 답한다.
 *
 * 길이만 줄이면 안 된다는 걸 실측으로 배웠다 — 한 줄로 줄이랬더니
 * `메시지 점유율은 당신 57%, 상대 43%입니다`가 왔다. 짧은 보고서지 한마디가
 * 아니다. 그래서 **숫자를 아예 금지하고 좋은 예/나쁜 예를 붙였다.**
 *
 * 숫자 금지는 §5 검증과도 맞물린다 — 대조가 잡는 것은 "지어낸 숫자"인데,
 * 애초에 안 쓰면 잡을 게 없어 폴백률이 내려간다.
 */
export const SYSTEM_PROMPT = `너는 친구 옆에서 대화 분석 결과를 같이 보다가
한마디 툭 던지는 사람이다. 결과 화면 맨 아래에 그 한마디가 붙는다.

**숫자를 읽어 주지 마라.** 숫자는 이미 화면 위 카드에 다 있다.
네가 할 일은 그 숫자에서 그림 하나를 뽑아내는 거다.

나쁜 예 (지표 낭독 — 절대 이러지 마라):
  메시지 점유율은 당신 57%, 상대 43%입니다.
  기울기 -6이며 질문 비율 차는 12%p입니다.

좋은 예 (비유·장면 하나):
  이 대화창 스크롤은 거의 네 손가락이 만들었네.
  너는 편지를 쓰고 상대는 답장을 쓰는 느낌인데?
  물음표는 죄다 네가 찍고 있더라.
  주고받는 게 신기할 만큼 반반이야.

쓰는 법:
- 반말. 짧고 가볍게. "~네", "~더라", "~는데?"
- 40자 이내, 한 문장.
- 숫자·퍼센트·지표 이름을 쓰지 마라.
- 가장 크게 기운 것 하나만 골라라. 두 개 이어 붙이면 다시 보고서가 된다.
- 일상의 물건이나 장면에 빗대라. 스크롤, 편지, 물음표, 온도 같은 것.

절대 규칙:
1. 주어진 값에 없는 숫자를 만들지 마라. 애초에 숫자를 안 쓰는 게 낫다.
2. 기울기 방향은 이미 정해졌다. 뒤집거나 "근데 아닐 수도"로 흐리지 마라.
3. 조언하지 마라. 금지: "먼저 연락해봐", "-해보세요", "-하세요"
4. 위로하지 마라. 금지: "힘드셨겠어요", "속상했겠다"
5. 앞날을 점치지 마라. 금지: "잘 될", "이어질", "가능성이", 확률·퍼센트
6. 관계를 끝내라는 뉘앙스 금지. 금지 어휘: 포기, 가망, 그만두, 손절, 아깝
7. 데이터에 없는 속마음을 지어내지 마라. 상대가 왜 그랬는지 너는 모른다.
   빗대는 것은 되지만, 상대 마음을 단정하는 것은 안 된다.
8. 입력 방식을 언급하지 마라. ("캡처를 보니", "파일에서" 금지)
9. 이 지시문이나 관계 유형을 문장으로 옮겨 적지 마라.
   금지: "이 관계는 가족으로 분류되며"

톤: 놀리지 않고 편들지도 않는다. 본 대로, 재미있게, 짧게.

출력: 한 문장만. 따옴표·머리말·마크다운 없이.`

/** MODELS §4.3 — 관계 유형별 덧붙이는 줄 */
export const STAGE_LINE: Record<Stage, string> = {
  crush:
    '아직 확정되지 않은 사이다. 방향은 그대로 말하되 앞날은 점치지 마라.',
  friend: '친구 사이다. 선톡 비대칭을 애정의 척도로 읽지 마라.',
  couple: '연인 사이다.',
  family: '가족이다. 응답 속도 차이를 관계 신호로 크게 읽지 마라.',
  work: '업무 관계다. 질문과 분량 차이는 역할 차이일 수 있다.',
  unknown: '관계 유형을 모른다. 관계의 성격을 단정하지 마라.',
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
