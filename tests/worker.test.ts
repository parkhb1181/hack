/**
 * Worker 반환 계약 — SPEC.md §3.10
 *
 * 요점은 하나다: **대화 원문 전체가 메인 스레드로 넘어가지 않는다.**
 * 판독 창 120개와 집계만 넘어간다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  HIGHLIGHT_CAP,
  parseFileText,
  readWithCarry,
  type ParsePayload,
} from '@/lib/parsers/txt-worker'
import { WINDOW_SIZE } from '@/lib/types'
import { readSeed } from './helpers'

function done(text: string): ParsePayload {
  const r = parseFileText(text)
  if (r.kind !== 'done') throw new Error(`예상과 다름: ${r.kind}`)
  return r.payload
}

describe('반환 계약 — 원문을 다 넘기지 않는다', () => {
  const payload = done(readSeed('seed_onesided', 'pc'))

  it('판독 창은 120개로 제한된다', () => {
    expect(payload.summary.total).toBeGreaterThan(WINDOW_SIZE)
    expect(payload.window).toHaveLength(WINDOW_SIZE)
  })

  it('집계에는 원문이 없다', () => {
    const json = JSON.stringify(payload.summary)
    expect(json).not.toContain('오늘')
    expect(json).not.toContain('ㅋㅋ')
  })

  it('명장면 후보에 상한이 있다', () => {
    expect(payload.highlights.length).toBeLessThanOrEqual(HIGHLIGHT_CAP)
  })

  it('지표에 필요한 집계가 다 들어 있다', () => {
    const s = payload.summary
    expect(s.byWho.me + s.byWho.other).toBe(s.total)
    expect(s.bursts.me + s.bursts.other).toBeGreaterThan(0)
    expect(Math.abs(s.bursts.me - s.bursts.other)).toBeLessThanOrEqual(1)
    expect(s.sessions).toBeGreaterThan(0)
    expect(s.infoUnits).toBeGreaterThan(0)
    expect(s.unparsed).toBe(0)
  })
})

describe('거절 경로', () => {
  it('iOS 포맷은 거절한다', () => {
    const ios = [
      '하늘 님과 카카오톡 대화',
      '2026. 7. 11. 오전 10:53, 하늘 : 안녕',
      '2026. 7. 11. 오전 10:54, 민서 : 어',
    ].join('\r\n')
    expect(parseFileText(ios)).toEqual({ kind: 'rejected', reason: 'ios' })
  })

  it('빈 파일은 거절한다', () => {
    expect(parseFileText('아무 내용 없음')).toEqual({
      kind: 'rejected',
      reason: 'unparseable',
    })
  })

  it('단톡은 거절한다 — 조용히 뭉개지 않는다', () => {
    const lines = ['모임 님과 카카오톡 대화', '--------------- 2026년 8월 4일 화요일 ---------------']
    for (let i = 0; i < 12; i++) {
      const who = ['민서', '하늘', '지훈', '수연'][i % 4]
      lines.push(`[${who}] [오전 ${9 + (i % 3)}:${String(10 + i).padStart(2, '0')}] 메시지 ${i} 입니다`)
    }
    const r = parseFileText(lines.join('\r\n'))
    expect(r.kind).toBe('rejected')
    if (r.kind === 'rejected') {
      expect(r.reason).toBe('group_chat')
      expect(r.speakers).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('캐리 버퍼 — §3.10', () => {
  /** 청크 경계를 일부러 \r 과 \n 사이에 떨어뜨린다 */
  function chunkedFile(text: string, chunk: number): File {
    const bytes = new TextEncoder().encode(text)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunk) {
          controller.enqueue(bytes.slice(i, i + chunk))
        }
        controller.close()
      },
    })
    return {
      size: bytes.length,
      stream: () => stream,
    } as unknown as File
  }

  const original = readSeed('seed_balanced', 'pc')

  it.each([7, 64, 1000])('청크 %i바이트로 잘라 읽어도 내용이 같다', async (size) => {
    const restored = await readWithCarry(chunkedFile(original, size))
    expect(restored).toBe(original)
  })

  it('쪼개 읽어도 파싱 결과가 같다', async () => {
    const restored = await readWithCarry(chunkedFile(original, 13))
    const a = done(original)
    const b = done(restored)
    expect(b.summary).toEqual(a.summary)
    expect(b.window).toEqual(a.window)
  })

  it('진행률이 0에서 1까지 올라간다', async () => {
    const seen: number[] = []
    await readWithCarry(chunkedFile(original, 5000), (r) => seen.push(r))
    expect(seen.length).toBeGreaterThan(1)
    expect(seen[seen.length - 1]).toBeCloseTo(1, 5)
    expect(seen.every((r, i) => i === 0 || r >= seen[i - 1])).toBe(true)
  })
})

describe('실파일', () => {
  const path = join(process.cwd(), 'fixtures', 'real', 'export_pc.txt')
  let text: string | null = null
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    text = null
  }

  it.skipIf(text === null)('398명 단톡을 거절한다', () => {
    const r = parseFileText(text as string)
    expect(r.kind).toBe('rejected')
    if (r.kind === 'rejected') expect(r.reason).toBe('group_chat')
  })
})
