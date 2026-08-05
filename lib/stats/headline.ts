/**
 * 헤드라인 — 기울기. SPEC.md §7
 *
 * 모든 계산은 판독 창(최근 120개) 기준이다.
 * 없는 축을 0으로 채우지 않는다. 0은 "균형"을 뜻하므로 결측이 방향을 왜곡한다(§7.2).
 */

import { bursts, byWho, mean } from '@/lib/corpus'
import type { Band, Corpus, Headline, Msg, Stage, Who } from '@/lib/types'

/** 비대칭 정규화. 양쪽이 모두 0이면 0(균형) */
export function norm(a: number, b: number): number {
  return a + b === 0 ? 0 : (a - b) / (a + b)
}

/** 메시지수 비대칭 */
export function axisMsgCount(msgs: Msg[]): number | null {
  if (msgs.length === 0) return null
  const g = byWho(msgs, (m) => m.who)
  return norm(g.me.length, g.other.length)
}

/**
 * 평균 길이 비대칭. text 메시지만 센다.
 *
 * charCount는 type !== 'text'에서 0으로 강제되므로(SPEC §2),
 * 미디어를 많이 보내는 쪽이 분량에서 유리해지지 않는다.
 */
export function axisMsgLength(msgs: Msg[]): number | null {
  const texts = msgs.filter((m) => m.type === 'text')
  if (texts.length === 0) return null
  const g = byWho(texts, (m) => m.who)
  if (g.me.length === 0 && g.other.length === 0) return null
  return norm(
    mean(g.me.map((m) => m.charCount)),
    mean(g.other.map((m) => m.charCount)),
  )
}

/** 질문 버스트 비율 비대칭. '?' 포함 버스트 / 전체 버스트 */
export function axisQuestion(msgs: Msg[]): number | null {
  const bs = bursts(msgs)
  if (bs.length === 0) return null
  const acc: Record<Who, { q: number; n: number }> = {
    me: { q: 0, n: 0 },
    other: { q: 0, n: 0 },
  }
  for (const b of bs) {
    acc[b.who].n += 1
    const hasQ = b.msgs.some(
      (m) => m.type === 'text' && m.text != null && m.text.includes('?'),
    )
    if (hasQ) acc[b.who].q += 1
  }
  if (acc.me.n === 0 || acc.other.n === 0) return null
  return norm(acc.me.q / acc.me.n, acc.other.q / acc.other.n)
}

/** 임베딩 축(옵셔널). 값은 semantic 레이어에서 온다. */
export type SemanticAxes = {
  syncMe: number
  syncOther: number
}

/**
 * 이 차이면 동조 축이 포화(±1)된다.
 *
 * ⚠️ 실데이터로 보정해야 하는 값이다. 합성 시드는 문장을 무작위로 뽑아 쓰므로
 * 진짜 맞물림이 없어 분포를 알 수 없다.
 */
export const SYNC_SCALE = 0.15

/**
 * 동조 축 — **`norm`을 쓰지 않는다.**
 *
 * 동조율은 무작위 짝 기준선을 뺀 값이라 음수가 될 수 있다. `norm(a,b)`는
 * 분모가 `a+b`라서 음수가 섞이면 0 근처에서 폭주한다(실측: 1.16이 나왔다).
 * 부호 있는 차이를 직접 쓰고 유계로 자른다.
 */
export function axisSync(s: SemanticAxes | null | undefined): number | null {
  if (!s) return null
  const diff = (s.syncMe - s.syncOther) / SYNC_SCALE
  return Math.max(-1, Math.min(1, diff))
}

/** 헤드라인 축의 총 개수. "4개 축 중 3개로 산출" 표시에 쓴다. */
export const AXES_TOTAL = 4

export function bandOf(tilt: number): Band {
  if (tilt >= 55) return 'strong_me'
  if (tilt >= 20) return 'lean_me'
  if (tilt > -20) return 'even'
  if (tilt > -55) return 'lean_other'
  return 'strong_other'
}

/** 라벨은 전부 "이 대화"를 주어로 쓴다 — 사람에 대한 판정이 아니다(SPEC §7.3) */
export const BAND_LABEL: Record<Band, string> = {
  strong_me: '이 대화는 당신 쪽으로 뚜렷하게 기울어 있습니다',
  lean_me: '당신 쪽으로 기울어 있습니다',
  even: '한쪽으로 기울었다고 보기 어렵습니다',
  lean_other: '상대 쪽으로 기울어 있습니다',
  strong_other: '이 대화는 상대 쪽으로 뚜렷하게 기울어 있습니다',
}

/**
 * 썸 전용 라벨.
 *
 * 같은 기울기라도 읽는 방향이 다르다 — 다른 관계에서 "+"는 중립 관찰이지만
 * 썸에서는 "나만 다가가고 있다"로 읽힌다. 그래도 **관찰 문장을 유지한다.**
 * "가망 없다" 류의 판정 어휘는 여기서도 금지다(PRD §4.5).
 */
export const CRUSH_BAND_LABEL: Record<Band, string> = {
  strong_me: '당신이 훨씬 더 많이 다가가고 있습니다',
  lean_me: '당신 쪽에서 더 다가가고 있습니다',
  even: '양쪽이 비슷하게 주고받고 있습니다',
  lean_other: '상대 쪽에서 더 다가오고 있습니다',
  strong_other: '상대가 훨씬 더 많이 다가오고 있습니다',
}

export function bandLabel(band: Band, stage: Stage = 'unknown'): string {
  return stage === 'crush' ? CRUSH_BAND_LABEL[band] : BAND_LABEL[band]
}

/** 이 값 미만이면 숫자를 숨기고 밴드 라벨만 표시한다 — SPEC §7.3 */
export const WINDOW_MIN_FOR_NUMBER = 60

export function computeHeadline(
  c: Corpus,
  semantic?: SemanticAxes | null,
): Headline {
  const w = c.window

  const raw: Record<string, number | null> = {
    msgCount: axisMsgCount(w),
    msgLength: axisMsgLength(w),
    question: axisQuestion(w),
    sync: c.availableFields.has('embedding') ? axisSync(semantic) : null,
  }

  const axes: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v != null) axes[k] = Math.round(v * 100) / 100
  }

  const used = Object.values(axes)
  // 가용 축만으로 평균한다. 결측을 0으로 채우지 않는다.
  const tilt = used.length === 0 ? 0 : Math.round((100 * used.reduce((a, b) => a + b, 0)) / used.length)

  return {
    tilt,
    band: bandOf(tilt),
    axesUsed: used.length,
    axesTotal: AXES_TOTAL,
    precisionReduced: c.windowFilled < WINDOW_MIN_FOR_NUMBER,
    axes,
  }
}

/** 근거 배지 — SPEC §7.4 */
export function evidenceBadge(c: Corpus, sessionCount: number | null): string {
  if (c.mode === 'txt') {
    const dates = c.messages
      .map((m) => m.date)
      .filter((d): d is string => d != null)
    const months =
      dates.length > 0
        ? monthSpan(dates[0], dates[dates.length - 1])
        : null
    const parts = [
      `메시지 ${c.messages.length.toLocaleString('ko-KR')}개 중 최근 ${c.windowFilled}개로 산출`,
    ]
    if (months != null) parts.push(`${months}개월`)
    if (sessionCount != null) parts.push(`세션 ${sessionCount}개`)
    return parts.join(' · ')
  }
  // 캡처는 date가 null이므로 기간을 표시하지 않고 구간만 표시한다.
  return `메시지 ${c.messages.length}개 · 캡처 구간`
}

function monthSpan(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm) + 1
}
