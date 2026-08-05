/**
 * 입력 → 리포트 한 방. 개발자 모드가 볼 추적 기록을 함께 낸다.
 *
 * 입력 다리가 둘이다 — **캡처 이미지**와 **대화 파일(txt/csv)**. 둘은 각자
 * 다른 방식으로 `Msg[]`를 만들고, 그 뒤로는 **같은 코드를 지난다.** 아래
 * 임베딩·리포트·LLM 어디에도 입력 종류를 보는 분기가 없다. 경로 차이는 오직
 * 필드 결측으로만 남는다(SPEC §2).
 *
 * 밖으로 나가는 지점은 둘뿐이다. OCR은 로컬 8756, 임베딩은 로컬 Ollama라
 * 대화 글자가 기기를 벗어나지 않는다. 비전은 글자 없는 조각만, LLM은 집계
 * 숫자만 받는다(MODELS §2.2 / §4.1).
 */

import { NextResponse } from 'next/server'

// Gemini를 쓰는 모듈보다 **먼저** 돌아야 한다. Next는 프로세스 환경을 우선하므로
// 셸에 남은 옛 키가 .env.local을 이긴다 — 실측으로 403이 났다(lib/env.ts 참고).
import { loadEnvLocal } from '@/lib/env'
loadEnvLocal()

import { buildCorpus } from '@/lib/corpus'
import {
  buildMetricBlock,
  interpret,
  LLM_MODEL,
  STAGE_LINE,
  SYSTEM_PROMPT,
} from '@/lib/llm/interpret'
import { isCsvFailure, parseCsv } from '@/lib/parsers/csv'
import {
  columnFilter,
  dropOversized,
  dropTopChrome,
  findHoles,
  groupBubbles,
  isUiGlyph,
  mergeMessages,
  mergeRowFragments,
  toMessages as ocrToMessages,
  type OcrLine,
  type OcrPage,
} from '@/lib/parsers/ocr'
import {
  isUnsupported,
  parseTxt,
  resolveWho,
  toMessages as txtToMessages,
  type ParseResult,
} from '@/lib/parsers/txt'
import { buildReport, isHardFloor } from '@/lib/report'
import {
  computeSemantic,
  computeStyleSep,
  computeSync,
  embedTargets,
  type VecMap,
} from '@/lib/semantic/metrics'
import { EMBED_MODEL, embedTexts } from '@/lib/semantic/ollama'
import { axisSync } from '@/lib/stats/headline'
import { computeOdds } from '@/lib/stats/odds'
import type {
  FilterStep,
  LlmTrace,
  PageTrace,
  SemanticTrace,
  TextTrace,
  Trace,
  VisionTrace,
} from '@/lib/trace'
import type { Msg, Semantic, Source, Stage } from '@/lib/types'
import { AFFECT_PROMPT, GEMINI_MODEL, readAffectDetailed } from '@/lib/vision/gemini'

export const runtime = 'nodejs'
/** 리포트를 서버에 남기지 않는다 — PRD §7.2 무상태 */
export const dynamic = 'force-dynamic'

const OCR_URL = process.env.OCR_SERVICE_URL ?? 'http://127.0.0.1:8756'

/**
 * 스트림이 열린 뒤에는 HTTP 상태 코드를 바꿀 수 없다. 실패를 예외로 던지고
 * 바깥에서 이벤트로 바꿔 보낸다.
 */
class Fail extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.error ?? '실패'))
    this.name = 'Fail'
  }
}

/** 처리 화면이 그릴 단계 — 실제로 도는 코드가 알린다 */
export type StageEvent = {
  key: 'read' | 'merge' | 'affect' | 'metric' | 'write'
  state: 'run' | 'done' | 'skip'
  /** 카드 오른쪽에 붙는 짧은 결과 ("42개 말풍선") */
  detail?: string
}

type Emit = (e: StageEvent) => void

const round3 = (n: number | null) => (n == null ? null : Math.round(n * 1000) / 1000)

/** 추적 기록에 담을 메시지 상한 — 개발자 모드에서 눈으로 보는 용도다 */
const TRACE_MESSAGES = 200

/* ------------------------------ OCR 서비스 ------------------------------ */

async function runOcr(file: File): Promise<OcrPage & { elapsed_sec?: number }> {
  const fd = new FormData()
  fd.append('file', file, file.name)
  const res = await fetch(`${OCR_URL}/ocr`, { method: 'POST', body: fd })
  if (!res.ok) {
    throw new Error(`OCR 서비스 ${res.status} — ${OCR_URL} 가 떠 있는지 확인하세요`)
  }
  return (await res.json()) as OcrPage & { elapsed_sec?: number }
}

async function runCrop(
  file: File,
  bands: Array<[number, number]>,
): Promise<Array<{ y: [number, number]; width: number; height: number; png_base64: string }>> {
  const fd = new FormData()
  fd.append('file', file, file.name)
  fd.append('bands', JSON.stringify(bands))
  const res = await fetch(`${OCR_URL}/crop`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`조각 내기 실패 ${res.status}`)
  return (await res.json()).crops
}

/* ------------------------------ 캡처 다리 ------------------------------ */

/** 두 줄 목록의 차집합을 "왜 떨어졌는가"와 함께 낸다 */
function diff(before: OcrLine[], after: OcrLine[], why: string): FilterStep['dropped'] {
  const kept = new Set(after)
  return before.filter((l) => !kept.has(l)).map((l) => ({ text: l.text, box: l.box, why }))
}

/** 필터 체인을 단계별로 되짚는다 — `prepareLines`와 같은 순서를 유지해야 한다 */
function traceFilters(page: OcrPage): FilterStep[] {
  const s0 = page.lines
  const s1 = mergeRowFragments(s0, page.width)
  const s2 = s1.filter((l) => !isUiGlyph(l.text))
  const s3 = columnFilter(s2, page.width, page.height)
  const s4 = dropOversized(s3)
  const s5 = dropTopChrome(s4, page.height)

  return [
    { name: '원본', kept: s0.length, dropped: [] },
    { name: '조각 줄 잇기', kept: s1.length, dropped: [] },
    { name: 'UI 아이콘 제거', kept: s2.length, dropped: diff(s1, s2, '한 글자 UI 기호') },
    { name: '열 정렬 필터', kept: s3.length, dropped: diff(s2, s3, '말풍선 열에 안 맞음') },
    {
      name: '큰 글자 제거',
      kept: s4.length,
      dropped: diff(s3, s4, '본문보다 지나치게 큼(그림 속 문구)'),
    },
    { name: '상단 UI 제거', kept: s5.length, dropped: diff(s4, s5, '상단 잔재 · 한글 비중 미달') },
  ]
}

type CaptureLeg = {
  messages: Msg[]
  pages: PageTrace[]
  ocrPages: OcrPage[]
  merge: Trace['merge']
  gaps: string[]
}

async function parseCaptures(files: File[]): Promise<CaptureLeg> {
  const pages: PageTrace[] = []
  const ocrPages: OcrPage[] = []
  const perPage: Msg[][] = []

  for (const file of files) {
    let page: OcrPage & { elapsed_sec?: number }
    try {
      page = await runOcr(file)
    } catch (e) {
      throw new Fail(502, { error: e instanceof Error ? e.message : 'OCR 실패' })
    }
    ocrPages.push(page)

    const bubbles = groupBubbles(page)
    const result = ocrToMessages(page)

    pages.push({
      label: file.name,
      width: page.width,
      height: page.height,
      ocrSec: page.elapsed_sec ?? null,
      rawLines: page.lines,
      filters: traceFilters(page),
      bubbles: bubbles.map((b) => ({
        who: b.who,
        box: b.box,
        time: b.time,
        date: b.date,
        text: b.lines.map((l) => l.text.trim()).join('\n'),
      })),
      holes: findHoles(page, bubbles),
      speakers: result.speakers,
      rejected: result.rejected ?? null,
      messages: result.messages,
    })
    perPage.push(result.messages)
  }

  const rejected = pages.find((p) => p.rejected)
  if (rejected) {
    throw new Fail(422, { error: `3인 이상 대화는 분석하지 않습니다 (화자 ${rejected.speakers}명, PRD §5)` })
  }

  const before = perPage.reduce((n, m) => n + m.length, 0)
  const merged = mergeMessages(
    perPage,
    files.map((f) => f.name),
  )

  return {
    messages: merged.messages,
    pages,
    ocrPages,
    merge: {
      pages: files.length,
      before,
      after: merged.messages.length,
      removed: before - merged.messages.length,
    },
    gaps: [
      ...new Set([
        ...merged.gaps,
        ...pages.flatMap((p) => (p.holes.length ? [`nontext_regions:${p.holes.length}`] : [])),
      ]),
    ],
  }
}

/* ------------------------------ 텍스트 다리 ------------------------------ */

type TextLeg = { messages: Msg[]; trace: TextTrace; source: Source; deleted: number }

/** 확장자가 아니라 **내용**으로 고른다 — 이름은 얼마든지 틀릴 수 있다 */
function looksLikeCsv(name: string, body: string): boolean {
  const head = body.replace(/^﻿/, '').split(/\r?\n/, 3).join('\n')
  if (/^\s*(date|"date"|날짜)\s*,/i.test(head)) return true
  if (/\.csv$/i.test(name)) return true
  // 첫 줄에 쉼표가 둘 이상이고 카톡 txt 머리글이 없으면 CSV로 본다
  return (head.match(/,/g)?.length ?? 0) >= 2 && !/님과 카카오톡 대화/.test(head)
}

async function parseTextFile(
  file: File,
  overrideMe: string | undefined,
): Promise<TextLeg> {
  const body = await file.text()
  const kind: TextTrace['kind'] = looksLikeCsv(file.name, body) ? 'csv' : 'txt'

  let p: ParseResult
  if (kind === 'csv') {
    const r = parseCsv(body)
    if (isCsvFailure(r)) {
      throw new Fail(422, { error: `CSV 형식을 읽지 못했습니다 — ${r.detail}` })
    }
    p = r
  } else {
    const r = parseTxt(body)
    if (isUnsupported(r)) {
      throw new Fail(422, {
            error:
              'iOS 내보내기는 txt가 아니라 CSV입니다. 카카오톡에서 CSV로 내보낸 파일을 넣어주세요.',
          })
    }
    p = r
  }
  const who = resolveWho(p.title, p.speakers, overrideMe)

  const trace: TextTrace = {
    label: file.name,
    kind,
    source: p.source,
    bytes: file.size,
    records: p.raw.length,
    unparsed: p.unparsed,
    deleted: p.deleted,
    system: p.system,
    speakers: p.speakers.map((s) => ({
      name: s.name,
      count: s.count,
      firstDate: s.firstDate,
      lastDate: s.lastDate,
    })),
    resolvedBy: who.resolved ? (overrideMe ? 'user' : 'title') : null,
    rejected: who.rejected,
  }

  if (who.rejected === 'group_chat') {
    throw new Fail(422, {
          error: `3인 이상 대화는 분석하지 않습니다 (화자 ${p.speakers.length}명, PRD §5)`,
          trace: { text: trace },
        })
  }

  // 제목 줄이 없는 형식(CSV)은 누가 '나'인지 알 수 없다. 추측하면 기울기 부호가
  // 통째로 뒤집히므로 **묻는다** — SPEC §3.10.
  if (!who.resolved) {
    throw new Fail(409, {
          error: '누가 본인인지 골라주세요',
          needsSpeaker: true,
          speakers: p.speakers.map((s) => ({ name: s.name, count: s.count })),
          trace: { text: trace },
        })
  }

  return {
    messages: txtToMessages(p.raw, who.map),
    trace,
    source: p.source,
    deleted: p.deleted,
  }
}

/* ------------------------------ 라우트 ------------------------------ */

async function pipeline(form: FormData, emit: Emit) {
  const t0 = Date.now()
  const timings: Record<string, number> = {}
  const mark = (k: string, from: number) => {
    timings[k] = Date.now() - from
  }

  const images = form.getAll('images').filter((f): f is File => f instanceof File)
  const textFile = form.get('file')
  const stage = ((form.get('stage') as string) || 'unknown') as Stage
  const useVision = form.get('vision') !== 'off'
  const useEmbed = form.get('embed') !== 'off'
  const useLlm = form.get('llm') !== 'off'
  const overrideMe = (form.get('me') as string) || undefined

  /* ── 1. 입력 → 공통 포맷 ───────────────────────────────────── */
  let messages: Msg[]
  let mode: 'capture' | 'txt'
  let source: Source = 'unknown'
  let pages: PageTrace[] = []
  let ocrPages: OcrPage[] = []
  let text: TextTrace | null = null
  let merge: Trace['merge'] = null
  let gaps: string[] = []

  emit({ key: 'read', state: 'run' })
  if (textFile instanceof File && textFile.size > 0) {
    const t = Date.now()
    const leg = await parseTextFile(textFile, overrideMe)
    mark('parse', t)
    emit({ key: 'read', state: 'done', detail: `${leg.messages.length}개 메시지` })
    emit({ key: 'merge', state: 'skip', detail: '파일은 한 덩어리라 이어붙일 게 없어요' })
    messages = leg.messages
    text = leg.trace
    source = leg.source
    mode = 'txt'
  } else if (images.length > 0) {
    const t = Date.now()
    const leg = await parseCaptures(images)
    mark('ocr', t)
    messages = leg.messages
    pages = leg.pages
    ocrPages = leg.ocrPages
    merge = leg.merge
    gaps = leg.gaps
    mode = 'capture'
    emit({
      key: 'read',
      state: 'done',
      detail: `${leg.pages.reduce((n, p) => n + p.bubbles.length, 0)}개 말풍선`,
    })
    emit({
      key: 'merge',
      state: 'done',
      detail: leg.merge ? `중복 ${leg.merge.removed}개 정리` : undefined,
    })
  } else {
    throw new Fail(400, { error: '캡처 이미지 또는 대화 파일(.txt / .csv)을 넣어주세요' })
  }

  /* ── 2. 비전 — 조각만 나간다 (캡처 전용) ──────────────────── */
  //
  // txt·csv에는 비텍스트 발화의 그림이 없다. 파일에는 `이모티콘`이라는
  // 플레이스홀더만 남아 있어서 정서를 읽을 대상이 아예 없다 — **경로 분기가
  // 아니라 대상 부재**다. 그래서 C급 지표가 LOCKED로 남는다(SPEC §5.2).
  let vision: VisionTrace | null = null
  if (!useVision || mode !== 'capture') {
    emit({
      key: 'affect',
      state: 'skip',
      detail: mode === 'txt' ? '파일에는 그림이 없어요' : undefined,
    })
  }
  if (useVision && mode === 'capture') {
    emit({ key: 'affect', state: 'run' })
    const tv = Date.now()
    const cropMeta: VisionTrace['crops'] = []
    const b64: string[] = []
    let enclosed = 0
    let cropError: string | null = null

    for (let i = 0; i < images.length; i++) {
      const holes = pages[i].holes
      if (holes.length === 0) continue
      // 구간에 글자가 걸리면 안 된다 — 걸리면 trimBand가 깨진 것이다
      for (const h of holes) {
        enclosed += ocrPages[i].lines.filter((l) => {
          if (isUiGlyph(l.text)) return false // 아이콘은 글자가 아니다
          const cy = (l.box[1] + l.box[3]) / 2
          return cy > h.y[0] && cy < h.y[1]
        }).length
      }
      try {
        const crops = await runCrop(
          images[i],
          holes.map((h) => h.y),
        )
        for (const c of crops) {
          cropMeta.push({ page: images[i].name, y: c.y, width: c.width, height: c.height })
          b64.push(c.png_base64)
        }
      } catch (e) {
        cropError = e instanceof Error ? e.message : '조각 실패'
        break
      }
    }

    let items: unknown[] = []
    let error = cropError
    let usedModel = GEMINI_MODEL
    let modelSkips: Array<{ model: string; why: string }> = []
    if (!error && b64.length > 0) {
      try {
        const run = await readAffectDetailed(b64)
        items = run.items
        usedModel = run.model
        modelSkips = run.skipped
      } catch (e) {
        error = e instanceof Error ? e.message.slice(0, 160) : 'Vision 실패'
      }
    }

    vision = {
      enabled: true,
      prompt: AFFECT_PROMPT,
      model: usedModel,
      skipped: modelSkips,
      crops: cropMeta,
      enclosedTextLines: enclosed,
      rawResponse: null,
      items,
      error,
    }

    // nontext 발화에 정서를 채워 넣는다. 실패하면 nontext로 남고
    // C급 지표만 LOCKED가 된다 — 헤드라인은 영향받지 않는다(SPEC §9.3).
    const nontext = messages.filter((m) => m.type === 'nontext')
    items.forEach((raw, idx) => {
      const it = raw as {
        type?: string
        emojiDesc?: string
        affect?: Msg['affect']
        confidence?: number
      }
      const target = nontext[idx]
      if (!target || !it) return
      if (it.type) target.type = it.type as Msg['type']
      if (it.emojiDesc) target.emojiDesc = it.emojiDesc
      if (it.affect) target.affect = it.affect
      if (typeof it.confidence === 'number') target.confidence = it.confidence
    })
    mark('vision', tv)
    const read = items.filter(Boolean).length
    emit({
      key: 'affect',
      state: error ? 'skip' : 'done',
      detail: error ? '이번엔 못 읽었어요' : read ? `${read}개 읽음` : '읽을 그림이 없었어요',
    })
  }

  /* ── 3. 임베딩 — 로컬 Ollama (두 경로 공통) ───────────────── */
  //
  // 꺼져 있으면 `semantic`이 null로 남고 동조율·말투 지표만 LOCKED가 된다 —
  // 헤드라인은 남은 축으로 계속 나온다(없는 축을 0으로 채우지 않는다).
  // 임베딩은 화면에 따로 안 띄우고 '지표 계산' 안에 넣는다. 사용자에게는
  // 같은 일이고, 여기만 7초씩 비어 있으면 멈춘 것처럼 보인다(실측).
  emit({ key: 'metric', state: 'run' })

  let semantic: SemanticTrace | null = null
  let semanticValue: Semantic | null = null
  if (useEmbed) {
    const ts = Date.now()
    const targets = embedTargets(messages)
    try {
      const { vectors, stats } = await embedTexts(targets.map((m) => m.text ?? ''))
      const vecs: VecMap = new Map(targets.map((m, i) => [m.seq, vectors[i]]))
      const sync = computeSync(messages, vecs)
      const sep = computeStyleSep(messages, vecs)
      semanticValue = computeSemantic(messages, vecs)
      semantic = {
        enabled: true,
        model: EMBED_MODEL,
        embedded: targets.length,
        skipped: messages.length - targets.length,
        cacheHits: stats.cacheHits,
        elapsedMs: Date.now() - ts,
        raw: sync.raw,
        baseline: sync.baseline,
        net: { me: sync.me, other: sync.other },
        pairs: sync.pairs,
        styleSep: sep.score,
        axis: round3(axisSync({ syncMe: sync.me, syncOther: sync.other } as never)),
        error: null,
      }
    } catch (e) {
      semantic = {
        enabled: true,
        model: EMBED_MODEL,
        embedded: 0,
        skipped: messages.length,
        cacheHits: 0,
        elapsedMs: Date.now() - ts,
        raw: null,
        baseline: null,
        net: null,
        pairs: 0,
        styleSep: null,
        axis: null,
        error: e instanceof Error ? e.message.slice(0, 120) : '임베딩 실패',
      }
    }
    mark('embed', ts)
  }

  /* ── 4. 코퍼스 → 리포트 (두 경로 공통) ────────────────────── */
  const corpus = buildCorpus(messages, {
    mode,
    source,
    embedding: semanticValue != null,
    semantic: semanticValue,
    deleted: text?.deleted,
    gaps,
  })
  const report = buildReport(corpus)
  const okCount = isHardFloor(report)
    ? 0
    : Object.values(report.metrics).filter((m) => m.status === 'OK').length
  emit({
    key: 'metric',
    state: 'done',
    detail: isHardFloor(report) ? '대화가 조금 짧아요' : `${okCount}개 지표`,
  })

  /* ── 5. LLM — 집계 숫자만 나간다 (두 경로 공통) ───────────── */
  let llm: LlmTrace | null = null
  if (!useLlm || isHardFloor(report)) emit({ key: 'write', state: 'skip' })
  if (useLlm && !isHardFloor(report)) {
    emit({ key: 'write', state: 'run' })
    const tl = Date.now()
    const block = buildMetricBlock(report, stage)
    const r = await interpret(report, stage)
    llm = {
      system: SYSTEM_PROMPT,
      stageLine: STAGE_LINE[stage],
      block,
      model: r.model ?? LLM_MODEL,
      skipped: r.skipped ?? [],
      text: r.text,
      source: r.source,
      reason: r.reason ?? null,
      elapsedMs: r.elapsedMs,
      verify: r.verify ?? null,
    }
    mark('llm', tl)
    emit({
      key: 'write',
      state: 'done',
      detail: r.source === 'llm' ? undefined : '기본 문장으로 대신했어요',
    })
  }

  mark('total', t0)

  const trace: Trace = {
    mode,
    pages,
    text,
    merge,
    corpus: {
      windowFilled: corpus.windowFilled,
      infoUnits: corpus.infoUnits,
      availableFields: [...corpus.availableFields],
      gaps: corpus.gaps ?? [],
      // 앞부분만 — txt는 수천 건이라 전부 실으면 응답이 수 MB가 된다
      messages: messages.slice(0, TRACE_MESSAGES),
      truncated: Math.max(0, messages.length - TRACE_MESSAGES),
    },
    vision,
    semantic,
    llm,
    timings,
  }

  return {
    report,
    trace,
    hardFloor: isHardFloor(report),
    // 퍼센트 카드 — 계산은 서버에서, 근거는 통째로 함께 보낸다(SPEC §7.3.3)
    odds: isHardFloor(report) ? null : computeOdds(report),
  }
}

/* ------------------------------ 스트리밍 ------------------------------ */

/**
 * NDJSON으로 단계를 흘린다 — 한 줄이 이벤트 하나.
 *
 * 처리 화면이 기다리는 시간을 채우려면 **실제 진행**을 받아야 한다.
 * 시간 기반 연출로 만들면 OCR이 20초 걸리는데 화면은 3초에 끝난 것처럼
 * 보인다. 이 프로젝트의 원칙("화면이 파이프라인을 재구현하지 않는다")과도
 * 어긋난다. 그래서 도는 쪽이 진행을 알린다.
 */
export async function POST(req: Request) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: '폼 데이터를 읽지 못했습니다' }, { status: 400 })
  }

  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`))
      try {
        const out = await pipeline(form, (e) => send({ type: 'stage', ...e }))
        send({ type: 'result', ...out })
      } catch (e) {
        // 스트림이 열린 뒤에는 상태 코드를 못 바꾼다. 실패도 이벤트로 보낸다.
        if (e instanceof Fail) send({ type: 'error', status: e.status, ...e.body })
        else send({ type: 'error', status: 500, error: e instanceof Error ? e.message : '실패' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      // 프록시가 모아서 한 번에 보내면 스트리밍이 무의미해진다
      'x-accel-buffering': 'no',
    },
  })
}






