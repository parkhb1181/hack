/**
 * 글자 수 세기 — 분량 지표의 기반
 *
 * `SPEC.md` §2가 미디어에 `charCount = 0`을 강제한 이유는 "미디어를 많이 보내는
 * 쪽이 분량에서 유리해지는 것을 막는 유일한 방어선"이기 때문이다.
 * **이모지가 같은 구멍을 낸다** — UTF-16 길이로 세면 눈에 보이는 글자 수보다
 * 최대 8배까지 부풀어 오른다.
 *
 *   '😃😃😃😃'   .length 8 → 실제 4
 *   '👨‍👩‍👧'  .length 8 → 실제 1  (ZWJ 결합)
 *   '🇰🇷'       .length 4 → 실제 1  (국기)
 */

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('ko', { granularity: 'grapheme' })
    : null

/** 눈에 보이는 글자 수. Segmenter가 없으면 코드포인트 단위로 폴백한다 */
export function graphemeCount(s: string): number {
  if (s.length === 0) return 0
  if (segmenter) {
    let n = 0
    for (const _ of segmenter.segment(s)) n += 1
    return n
  }
  return [...s].length
}

/** 그림문자 — 유니코드 이모지. 카카오 스티커와는 다른 것이다 */
const PICTOGRAPH = /\p{Extended_Pictographic}/u

export function hasEmoji(s: string): boolean {
  return PICTOGRAPH.test(s)
}

/** 이모지와 공백만으로 이루어진 메시지 — 분량이 아니라 정서 신호다 */
export function isEmojiOnly(s: string): boolean {
  const t = s.trim()
  if (t.length === 0) return false
  if (!PICTOGRAPH.test(t)) return false
  return /^[\p{Extended_Pictographic}\p{Emoji_Component}\p{Emoji_Modifier}️‍\s]+$/u.test(t)
}

/**
 * 분량으로 셀 글자 수.
 *
 * 이모지는 길이에서 제외한다 — 정서 신호이지 분량이 아니다.
 * 이모지만 있는 메시지는 0이 된다.
 */
/**
 * 한국어 조사를 앞 글자의 받침에 맞춰 붙인다.
 *
 * 조사를 문자열에 박아두면 **반드시 틀린다.** 실측으로 두 번 나갔다 —
 * `상대이 51% 보냈고`(폴백 문장), `세션가 더 필요합니다`(지표 카드).
 * 대상 단어가 몇 개뿐일 때도 규칙으로 두는 편이 낫다. 라벨이 늘어나면
 * 같은 실수가 다시 난다.
 *
 * 숫자·영문으로 끝나면 받침 여부를 알 수 없으므로 받침 없는 쪽으로 둔다.
 *
 * ⚠️ **앞이 항상 받침 있을 때다.** `과/와`를 관용 표기인 `와/과`로 쓰면
 * 뒤집힌다 — 이 쌍만 받침 쪽이 `과`이기 때문이다(실측으로 `상대과`가 나왔다).
 */
export function josa(word: string, pair: '이/가' | '을/를' | '은/는' | '과/와'): string {
  const [withBatchim, without] = pair.split('/')
  const last = word.charCodeAt(word.length - 1)
  const isHangul = last >= 0xac00 && last <= 0xd7a3
  const hasBatchim = isHangul && (last - 0xac00) % 28 !== 0
  return `${word}${hasBatchim ? withBatchim : without}`
}

export function countableLength(s: string): number {
  const stripped = s.replace(
    /[\p{Extended_Pictographic}\p{Emoji_Component}\p{Emoji_Modifier}️‍]/gu,
    '',
  )
  return graphemeCount(stripped.trim())
}
