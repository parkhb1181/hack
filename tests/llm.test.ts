/**
 * LLM 후검증 — MODELS.md §5
 *
 * 핵심은 하나: **LLM이 지어낸 숫자가 화면에 못 나간다.**
 * 네트워크를 타지 않는 순수 함수만 검증한다.
 */

import { describe, expect, it } from 'vitest'

import { buildMetricBlock, STAGE_LINE, SYSTEM_PROMPT } from '@/lib/llm/interpret'
import { fallbackSentence, hardFloorSentence, meOther } from '@/lib/llm/fallback'
import {
  BANNED_WORDS,
  MAX_SENTENCES,
  allowedNumbers,
  collectNumbers,
  countSentences,
  verify,
  verifyNumbers,
  verifyWords,
} from '@/lib/llm/verify'
import { derivedFigures, verifiableAggregate } from '@/lib/llm/figures'
import { buildReport, isHardFloor } from '@/lib/report'
import type { Report, Stage } from '@/lib/types'
import { txtCorpus } from './helpers'

const corpus = txtCorpus('seed_onesided')
const report = buildReport(corpus)
if (isHardFloor(report)) throw new Error('시드가 하드 플로어에 걸렸습니다')
const R = report as Report
const A = verifiableAggregate(R)

describe('숫자 대조 — §5', () => {
  it('집계에서 숫자를 전부 긁는다', () => {
    const nums = collectNumbers({ a: 1, b: [2, 3], c: { d: 4.5 }, e: 'x' })
    expect(nums.sort((x, y) => x - y)).toEqual([1, 2, 3, 4.5])
  })

  it('반올림·퍼센트 표기를 허용한다', () => {
    const allowed = allowedNumbers({ rate: 0.317 })
    expect(allowed.has('32')).toBe(true) // round(0.317*100)
    expect(allowed.has('0.3')).toBe(true) // toFixed(1)
  })

  it('집계에 있는 숫자는 통과한다', () => {
    const tilt = R.headline.tilt
    expect(verifyNumbers(`기울기 ${tilt}입니다.`, A).ok).toBe(true)
  })

  it('지어낸 숫자는 걸린다 — 이게 존재 이유', () => {
    const r = verifyNumbers('먼저 말을 건 쪽은 당신이 87%입니다.', A)
    expect(r.ok).toBe(false)
    expect(r.bad).toContain('87')
  })

  it('서수 0~3은 화이트리스트', () => {
    expect(verifyNumbers('두 사람 사이에 3가지 신호가 있습니다.', A).ok).toBe(true)
  })

  it('불일치가 1개라도 있으면 실패다', () => {
    const tilt = R.headline.tilt
    const r = verifyNumbers(`기울기 ${tilt}이고 응답은 41분입니다.`, A)
    expect(r.ok).toBe(false)
  })
})

describe('금지 표현 — §4.2', () => {
  it.each(BANNED_WORDS)('밀어내는 어휘 "%s"를 잡는다', (w) => {
    expect(verifyWords(`이 관계는 ${w}입니다.`).length).toBeGreaterThan(0)
  })

  it('앞날 예측을 잡는다 — 규칙 7', () => {
    expect(verifyWords('두 분은 잘 될 것 같습니다.').length).toBeGreaterThan(0)
    expect(verifyWords('이어질 가능성이 높습니다.').length).toBeGreaterThan(0)
  })

  it('위로·조언을 잡는다 — 규칙 3', () => {
    expect(verifyWords('많이 힘드셨겠어요.').length).toBeGreaterThan(0)
    expect(verifyWords('먼저 연락해보세요.').length).toBeGreaterThan(0)
  })

  it('표본을 오도하는 표현을 잡는다', () => {
    expect(verifyWords('당신은 항상 먼저 연락합니다.').length).toBeGreaterThan(0)
  })

  it('관찰 문장은 통과한다', () => {
    expect(verifyWords('메시지는 당신이 더 많이 보냈습니다.')).toHaveLength(0)
  })
})

describe('길이 — §4.2 규칙 8', () => {
  it('문장 수를 센다', () => {
    expect(countSentences('하나. 둘. 셋.')).toBe(3)
    expect(countSentences('하나입니다')).toBe(1)
  })

  it('3문장을 넘으면 실패한다', () => {
    const long = '가. 나. 다. 라.'
    expect(verify(long, A).sentences).toBeGreaterThan(MAX_SENTENCES)
    expect(verify(long, A).ok).toBe(false)
  })
})

describe('집계 블록 — §4.1', () => {
  const block = buildMetricBlock(R, 'crush')

  it('방향과 단위를 주석으로 붙인다', () => {
    expect(block).toContain('#')
    expect(block).toContain('기울기')
    expect(block).toContain('표본')
  })

  it('말버릇과 명장면 원문은 넣지 않는다', () => {
    expect(block).not.toContain('말버릇')
    expect(block).not.toContain('phraseGap')
    // 시드 본문이 새어나가지 않는다
    expect(block).not.toContain('오늘 좀 힘들었어')
  })

  it('LOCKED·INSUFFICIENT 지표는 블록에 없다', () => {
    expect(block).not.toContain('LOCKED')
    expect(block).not.toContain('INSUFFICIENT')
  })

  /**
   * 화면이 숨긴 값을 문단이 대신 말하면 숨긴 의미가 없다.
   *
   * 실측: 22건 표본에서 화면은 밴드 라벨만 보여주는데 LLM이
   * "기울기는 30으로 측정되어"라고 써서 숫자가 그대로 새어 나갔다.
   */
  it('표본이 얇으면 기울기 숫자를 프롬프트에 넣지 않는다 — SPEC §7.3', () => {
    const thin = {
      ...R,
      headline: { ...R.headline, precisionReduced: true },
    } as Report

    const b = buildMetricBlock(thin, 'crush')
    expect(b).not.toContain(`기울기: ${R.headline.tilt}`)
    expect(b).toContain('기울기 방향')
    expect(b).toContain('쓰지 마라')

    // 폴백도 같은 규칙을 따른다
    expect(fallbackSentence(thin, 'crush')).not.toContain(`기울기 ${R.headline.tilt}`)
  })

  it('표본이 충분하면 숫자를 그대로 준다', () => {
    const full = {
      ...R,
      headline: { ...R.headline, precisionReduced: false },
    } as Report
    expect(buildMetricBlock(full, 'crush')).toContain(`기울기: ${R.headline.tilt}`)
  })
})

describe('프롬프트 — 문서와 어긋나면 안 된다', () => {
  it('금지 어휘가 프롬프트에 들어 있다', () => {
    for (const w of BANNED_WORDS) expect(SYSTEM_PROMPT).toContain(w)
  })

  it('관계 유형이 전부 정의돼 있다', () => {
    const stages: Stage[] = ['crush', 'couple', 'friend', 'family', 'work', 'unknown']
    for (const s of stages) expect(STAGE_LINE[s]).toBeTruthy()
  })

  it('썸 줄이 앞날 예측을 금지한다', () => {
    expect(STAGE_LINE.crush).toContain('예측하지 않는다')
  })

  it('어투를 지정한다 — 규칙 9', () => {
    // 지정하지 않으면 LLM은 "-했다", 폴백은 "-습니다"로 갈린다(실측)
    expect(SYSTEM_PROMPT).toContain('-습니다')
    expect(fallbackSentence(R, 'crush')).toContain('니다')
  })
})

describe('폴백 — §6', () => {
  const text = fallbackSentence(R, 'crush')

  it('자기 검증을 통과한다 — 폴백이 검증에 걸리면 안 된다', () => {
    const v = verify(text, A)
    expect(v.badNumbers).toEqual([])
    expect(v.violations).toEqual([])
  })

  /** 실측: "상대이 51% 보냈고"가 화면에 나갔다 */
  it('주격 조사를 받침에 맞춘다', () => {
    expect(meOther('당신')).toBe('당신이')
    expect(meOther('상대')).toBe('상대가')
    expect(fallbackSentence(R, 'crush')).not.toContain('상대이')
  })

  it('가용하지 않은 축은 언급하지 않는다 — §6.4', () => {
    // seed는 임베딩·C급이 없다
    expect(text).not.toContain('이모티콘의 정서')
  })

  it('변화점을 넣어도 검증을 통과한다 — §6.2', () => {
    // month는 "2025-03" 문자열이라 집계 숫자로 안 잡힌다. 연도를 그대로 쓰면
    // "2025"가 없는 숫자로 걸리므로, figures가 월만 떼어 올려야 한다.
    const withCp = {
      ...R,
      metrics: {
        ...R.metrics,
        changePoint: { status: 'OK', value: { month: '2025-03', drop: 41.2 } },
      },
    } as unknown as Report

    const f = derivedFigures(withCp)
    expect(f.changeMonth).toBe(3)
    expect(f.changeDropPct).toBe(41.2)

    const s = fallbackSentence(withCp, 'crush')
    expect(s).toContain('3월부터')
    expect(s).not.toContain('2025')

    const v = verify(s, verifiableAggregate(withCp))
    expect(v.badNumbers).toEqual([])
    expect(v.violations).toEqual([])
  })

  it('하드 플로어 문장은 단정하지 않는다', () => {
    expect(hardFloorSentence(null)).toContain('모이지 않았습니다')
    expect(hardFloorSentence('답장은 상대가 더 느립니다')).toContain('답장은')
  })
})




