'use client'

/**
 * 사용자 화면 — 온보딩 → 업로드 → 처리 → 결과 → 지표
 *
 * 목업(malang-coral.html)이 기준이다. 관계는 **썸으로 고정**이라 온보딩에서
 * 고르지 않는다.
 *
 * 처리 화면은 **실제 진행**을 받는다. `/api/analyze`가 NDJSON으로 단계를
 * 흘리고 여기서 그린다. 시간 기반 연출로 만들면 OCR이 20초 걸리는데 화면은
 * 3초에 끝난 것처럼 보인다 — 실측 캡처 3장이 35초, txt가 5.6초였다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { renderMetric } from '@/lib/stats/format'
import type { Odds } from '@/lib/stats/odds'
import type { HardFloor, Report } from '@/lib/types'
import type { Trace } from '@/lib/trace'

/* ------------------------------ 단계 정의 ------------------------------ */

type StageKey = 'read' | 'merge' | 'affect' | 'metric' | 'write'
type StageState = 'wait' | 'run' | 'done' | 'skip'

const STEPS: Array<{ key: StageKey; name: string }> = [
  { key: 'read', name: '대화 읽는 중' },
  { key: 'merge', name: '겹친 데 이어붙이는 중' },
  { key: 'affect', name: '이모티콘 마음 읽는 중' },
  { key: 'metric', name: '숫자 세는 중' },
  { key: 'write', name: '한 문단 쓰는 중' },
]

/** 기다리는 동안 굴러가는 한마디. 지루함을 채우는 게 목적이다 */
const TIPS = [
  '누가 먼저 말을 거는지 세고 있어요.',
  '이모티콘은 내보내기하면 사라져요. 캡처라서 읽을 수 있는 거예요.',
  '답장 속도는 애정이 아니라 습관일 때가 더 많대요.',
  '메시지가 길다고 좋은 것도, 짧다고 나쁜 것도 아니에요.',
  '같은 말을 몇 번 했는지도 보고 있어요.',
  '이 숫자는 대화 패턴이에요. 마음의 크기는 아니고요.',
  '거의 다 됐어요. 문장 다듬는 중이에요.',
]

/* ------------------------------ 응답 ------------------------------ */

type Result = {
  report: Report | HardFloor
  trace: Trace
  hardFloor: boolean
  odds: Odds[] | null
}

type Screen = 'intro' | 'upload' | 'run' | 'result' | 'metrics'

/** 퍼센트 → 한마디. 숫자만 크면 무슨 뜻인지 안 와닿는다 */
function phraseOf(pct: number): string {
  if (pct >= 75) return '이미 넘어왔어요'
  if (pct >= 60) return '슬슬 넘어오는 중'
  if (pct >= 45) return '아직 반반이에요'
  if (pct >= 30) return '조금 더 두고 봐야 해요'
  return '지금은 당신이 더 가 있어요'
}

export default function Flow() {
  const [screen, setScreen] = useState<Screen>('intro')
  const [files, setFiles] = useState<File[]>([])
  const [agreed, setAgreed] = useState(true)

  const [steps, setSteps] = useState<Record<StageKey, { state: StageState; detail?: string }>>({
    read: { state: 'wait' },
    merge: { state: 'wait' },
    affect: { state: 'wait' },
    metric: { state: 'wait' },
    write: { state: 'wait' },
  })
  const [tip, setTip] = useState(0)
  const [res, setRes] = useState<Result | null>(null)
  const [err, setErr] = useState<string | null>(null)
  /** CSV처럼 제목 줄이 없으면 누가 본인인지 물어야 한다 — SPEC §3.10 */
  const [pick, setPick] = useState<Array<{ name: string; count: number }> | null>(null)
  const [me, setMe] = useState('')

  const isText = (f: File) => /\.(txt|csv)$/i.test(f.name) || f.type.startsWith('text/')
  const textFile = files.find(isText) ?? null
  const images = files.filter((f) => !isText(f))

  // 처리 화면에서만 한마디를 굴린다
  useEffect(() => {
    if (screen !== 'run') return
    const id = setInterval(() => setTip((t) => (t + 1) % TIPS.length), 3200)
    return () => clearInterval(id)
  }, [screen])

  const run = useCallback(
    async (meName?: string) => {
      if (files.length === 0) return
      setScreen('run')
      setErr(null)
      setRes(null)
      setPick(null)
      setTip(0)
      setSteps({
        read: { state: 'wait' },
        merge: { state: 'wait' },
        affect: { state: 'wait' },
        metric: { state: 'wait' },
        write: { state: 'wait' },
      })

      const fd = new FormData()
      if (textFile) fd.append('file', textFile)
      else for (const f of images) fd.append('images', f)
      fd.append('stage', 'crush')
      if (meName) fd.append('me', meName)

      try {
        const r = await fetch('/api/analyze', { method: 'POST', body: fd })
        const reader = r.body?.getReader()
        if (!reader) throw new Error('응답을 읽지 못했어요')
        const dec = new TextDecoder()
        let buf = ''

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.trim()) continue
            const e = JSON.parse(line) as Record<string, unknown>

            if (e.type === 'stage') {
              const key = e.key as StageKey
              setSteps((s) => ({
                ...s,
                [key]: { state: e.state as StageState, detail: e.detail as string | undefined },
              }))
            } else if (e.type === 'error') {
              if (e.needsSpeaker) {
                setPick(e.speakers as Array<{ name: string; count: number }>)
                setMe((e.speakers as Array<{ name: string }>)[0]?.name ?? '')
                setScreen('upload')
              } else {
                setErr(String(e.error))
                setScreen('upload')
              }
              return
            } else if (e.type === 'result') {
              setRes(e as unknown as Result)
              setScreen('result')
            }
          }
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : '분석에 실패했어요')
        setScreen('upload')
      }
    },
    [files, textFile, images],
  )

  return (
    <div className="phone">
      <div className="statusbar">
        <span>9:41</span>
        <span className="dots">▮▮▮</span>
      </div>

      {screen === 'intro' && <Intro onNext={() => setScreen('upload')} />}

      {screen === 'upload' && (
        <Upload
          files={files}
          setFiles={setFiles}
          agreed={agreed}
          setAgreed={setAgreed}
          err={err}
          pick={pick}
          me={me}
          setMe={setMe}
          onRun={run}
          onBack={() => setScreen('intro')}
        />
      )}

      {screen === 'run' && <Running steps={steps} tip={TIPS[tip]} />}

      {screen === 'result' && res && (
        <ResultView
          res={res}
          onBack={() => setScreen('upload')}
          onMetrics={() => setScreen('metrics')}
        />
      )}

      {screen === 'metrics' && res && (
        <MetricsView res={res} onBack={() => setScreen('result')} />
      )}
    </div>
  )
}

/* ------------------------------ 1. 온보딩 ------------------------------ */

function Intro({ onNext }: { onNext: () => void }) {
  return (
    <div className="body">
      <div className="logo">↗</div>
      <h2 className="big">
        우리 대화,
        <br />
        어느 쪽으로
        <br />
        기울어 있을까요?
      </h2>
      <p className="lead">
        카톡 캡처 몇 장이면 충분해요.
        <br />
        누가 더 다가가고 있는지 숫자로 보여드릴게요.
      </p>

      <div className="notice">
        <span className="hint">
          <b>썸 모드로 봐요.</b> 같은 숫자라도 친구 사이랑 썸은 읽는 방향이 달라서요.
        </span>
      </div>

      <div className="spacer" style={{ paddingBottom: 8 }}>
        <div className="notice" style={{ marginBottom: 14 }}>
          <span className="hint">이미지는 분석이 끝나면 바로 사라져요. 어디에도 저장하지 않아요.</span>
        </div>
        <button className="cta" onClick={onNext}>
          시작하기
        </button>
      </div>
    </div>
  )
}

/* ------------------------------ 2. 업로드 ------------------------------ */

function Upload({
  files,
  setFiles,
  agreed,
  setAgreed,
  err,
  pick,
  me,
  setMe,
  onRun,
  onBack,
}: {
  files: File[]
  setFiles: (f: File[]) => void
  agreed: boolean
  setAgreed: (v: boolean) => void
  err: string | null
  pick: Array<{ name: string; count: number }> | null
  me: string
  setMe: (v: string) => void
  onRun: (me?: string) => void
  onBack: () => void
}) {
  const capRef = useRef<HTMLInputElement>(null)
  const isText = (f: File) => /\.(txt|csv)$/i.test(f.name) || f.type.startsWith('text/')
  const textFile = files.find(isText) ?? null
  const images = files.filter((f) => !isText(f))
  const [previews, setPreviews] = useState<string[]>([])

  useEffect(() => {
    const urls = images.slice(0, 2).map((f) => URL.createObjectURL(f))
    setPreviews(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files])

  return (
    <div className="body">
      <div className="navbar">
        <button className="icon" onClick={onBack}>
          ←
        </button>
        <span className="title">대화 넣기</span>
        <span className="icon" />
      </div>

      <h2 className="mid">대화를 보여주세요</h2>
      <p className="lead" style={{ marginBottom: 18 }}>
        캡처 몇 장이든, 전체 파일이든 좋아요.
      </p>

      <div className="scroll">
        <label className="drop">
          <input
            ref={capRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={(e) => setFiles([...(e.target.files ?? [])])}
          />
          <div className="plus">+</div>
          <div className="t">{images.length ? `캡처 ${images.length}장 골랐어요` : '카톡 캡처 올리기'}</div>
          <div className="s">1~10장 · PNG · JPG · 겹쳐 찍어도 알아서 이어붙여요</div>
          <div className="thumbs">
            {previews.map((u) => (
              // eslint-disable-next-line @next/next/no-img-element
              <div className="th" key={u}>
                <img src={u} alt="" />
              </div>
            ))}
            {previews.length < 2 && <div className="th" />}
            {previews.length < 2 && <div className="th" />}
            <div className="th more">+</div>
          </div>
        </label>

        <div className="divider">
          <i />
          <span>또는</span>
          <i />
        </div>

        <label className="sheetcard" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="file"
            accept=".txt,.csv,text/plain,text/csv"
            onChange={(e) => setFiles([...(e.target.files ?? [])])}
          />
          <div>
            <div style={{ fontSize: 15, color: 'var(--ink)', fontWeight: 700 }}>
              전체 대화 파일 (txt · csv)
            </div>
            <div style={{ fontSize: 12, color: 'var(--mute-2)', marginTop: 4 }}>
              {textFile ? textFile.name : '선톡률 · 월별 온도까지 전부 열려요'}
            </div>
          </div>
          <span
            style={{
              background: 'var(--soft-2)',
              color: 'var(--deep)',
              borderRadius: 999,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            고르기
          </span>
        </label>

        {/*
          목업 문구는 사실과 달랐다. 파싱은 기기가 아니라 서버가 하고,
          임베딩도 최근 120개가 아니라 전체를 태운다. 다만 둘 다 로컬이라
          기기 밖으로는 안 나간다. 틀린 프라이버시 주장을 띄우면 안 되므로
          같은 톤으로 맞는 말을 쓴다.
        */}
        <div className="notice" style={{ marginTop: 18 }}>
          <div className="hint">
            <b>대화 글자는 이 컴퓨터 안에서만 읽어요.</b> 밖으로 나가는 건 이모티콘 그림 조각이랑
            계산이 끝난 숫자뿐이에요. 대화 내용은 안 보내요.
          </div>
        </div>

        <label className="check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span className="box">{agreed ? '✓' : ''}</span>
          제가 참여한 대화만 올릴게요
        </label>

        {err && <div className="err">{err}</div>}

        {/* 제목 줄이 없는 형식은 추측하면 기울기 부호가 통째로 뒤집힌다 */}
        {pick && (
          <div className="err">
            <div style={{ fontWeight: 700, marginBottom: 8 }}>둘 중 누가 본인이에요?</div>
            <div style={{ fontSize: 12.5, color: 'var(--mute)', marginBottom: 12 }}>
              파일에 이름표가 없어서 자동으로 못 정했어요. 잘못 고르면 방향이 반대로 나와요.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {pick.map((s) => (
                <button
                  key={s.name}
                  className="pill"
                  data-on={me === s.name}
                  onClick={() => setMe(s.name)}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <button
              className="cta"
              style={{ marginTop: 14 }}
              disabled={!me}
              onClick={() => onRun(me)}
            >
              이 사람이 나예요
            </button>
          </div>
        )}
      </div>

      <div className="spacer" style={{ paddingTop: 16 }}>
        <button className="cta" disabled={files.length === 0 || !agreed} onClick={() => onRun()}>
          분석 시작
        </button>
      </div>
    </div>
  )
}

/* ------------------------------ 3. 처리 ------------------------------ */

function Running({
  steps,
  tip,
}: {
  steps: Record<StageKey, { state: StageState; detail?: string }>
  tip: string
}) {
  const done = STEPS.filter((s) => ['done', 'skip'].includes(steps[s.key].state)).length
  const pct = Math.round((done / STEPS.length) * 100)

  return (
    <div className="body">
      <div style={{ textAlign: 'center', marginTop: 28 }}>
        <div className="logo lg" style={{ margin: '0 auto' }}>
          ↗
        </div>
        <h2 className="mid" style={{ marginBottom: 6 }}>
          대화를 읽고 있어요
        </h2>
        <p className="lead" style={{ marginBottom: 0, fontSize: 13.5 }}>
          한 번에 끝나는 게 아니라, 다섯 단계를 지나요.
        </p>
      </div>

      <div className="stack" style={{ marginTop: 28, gap: 10 }}>
        {STEPS.map((s, i) => {
          const st = steps[s.key]
          return (
            <div className="step" key={s.key} data-state={st.state}>
              <span className="mark">
                {st.state === 'done' || st.state === 'skip' ? '✓' : st.state === 'run' ? '' : i + 1}
              </span>
              <span className="name">{s.name}</span>
              {st.detail && <span className="detail">{st.detail}</span>}
            </div>
          )
        })}
      </div>

      <div className="spacer" style={{ paddingTop: 24 }}>
        <div className="tip">{tip}</div>
        <div className="bar" style={{ marginTop: 14 }}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--mute-2)', marginTop: 10, textAlign: 'center' }}>
          이미지는 분석이 끝나면 바로 사라져요
        </div>
      </div>
    </div>
  )
}

/* ------------------------------ 4. 결과 ------------------------------ */

function ResultView({
  res,
  onBack,
  onMetrics,
}: {
  res: Result
  onBack: () => void
  onMetrics: () => void
}) {
  const { report, trace, hardFloor, odds } = res

  if (hardFloor) {
    const f = report as HardFloor
    return (
      <div className="body">
        <div className="navbar">
          <button className="icon" onClick={onBack}>
            ←
          </button>
          <span className="title">분석 결과</span>
          <span className="icon" />
        </div>
        <div className="hero" style={{ marginTop: 24 }}>
          <div className="phrase" style={{ fontSize: 19 }}>
            대화가 조금 짧아요
          </div>
          <p className="lead" style={{ marginTop: 12, marginBottom: 0 }}>
            아직 방향을 말하긴 일러요. 캡처를 몇 장 더 올려주시면 훨씬 잘 보여요.
          </p>
          {f.singleFact && <div className="chip">확실한 건 하나 — {f.singleFact}</div>}
        </div>
        <div className="spacer">
          <button className="cta" onClick={onBack}>
            더 올리기
          </button>
        </div>
      </div>
    )
  }

  const r = report as Report
  const main = odds?.find((o) => o.key === 'reciprocity') ?? odds?.[0]
  const pct = main ? main.percent : 50
  const h = r.headline

  return (
    <div className="body">
      <div className="navbar">
        <button className="icon" onClick={onBack}>
          ←
        </button>
        <span className="title">분석 결과</span>
        <span className="icon">⋯</span>
      </div>

      <div className="scroll">
        <div className="hero">
          <div className="cap">고백 성공 확률</div>
          <div className="num">
            {main?.coarse ? pct : pct.toFixed(0)}
            <span>%</span>
          </div>
          <div className="phrase">{phraseOf(pct)}</div>
          <div className="gauge">
            <i style={{ width: `${pct}%` }} />
            <b style={{ left: `${pct}%` }} />
          </div>
          <div className="ends">
            <span>0</span>
            <span>100</span>
          </div>
          <div className="chip">
            메시지 {r.windowFilled}개 · {trace.mode === 'capture' ? '캡처' : '전체 파일'} 구간 ·{' '}
            {h.axesTotal}개 축 중 {h.axesUsed}개로 산출
          </div>
        </div>

        <div className="tiltcard">
          <div className="row">
            <div className="lab">이 대화의 기울기</div>
            <div className="val">
              {h.precisionReduced ? '—' : `${h.tilt > 0 ? '+' : ''}${h.tilt}`}
            </div>
          </div>
          <div className="tags">
            {Object.entries(h.axes)
              .filter(([, v]) => Math.abs(v as number) >= 0.1)
              .map(([k, v]) => (
                <span key={k}>
                  {AXIS_NAME[k] ?? k} →{(v as number) > 0 ? '내 쪽' : '상대 쪽'}
                </span>
              ))}
          </div>
          <div className="say">
            {h.tilt > 12
              ? '당신 쪽에서 더 다가가고 있어요'
              : h.tilt < -12
                ? '상대 쪽에서 더 다가오고 있어요'
                : '둘이 비슷하게 주고받고 있어요'}
          </div>
        </div>

        {trace.llm?.text && (
          <div className="para">
            <div className="cap">한 문단 해석</div>
            <div className="t">{trace.llm.text}</div>
          </div>
        )}
      </div>

      <div className="actions">
        <button className="cta ghost" onClick={onBack}>
          다시 하기
        </button>
        <button className="cta" onClick={onMetrics}>
          지표 자세히
        </button>
      </div>
    </div>
  )
}

const AXIS_NAME: Record<string, string> = {
  msgCount: '메시지 수',
  msgLength: '평균 길이',
  question: '질문',
  sync: '맞춰주기',
}

/* ------------------------------ 5. 지표 ------------------------------ */

function MetricsView({ res, onBack }: { res: Result; onBack: () => void }) {
  const r = res.report as Report
  const entries = Object.entries(r.metrics)
  const ok = entries.filter(([, m]) => m.status === 'OK')
  const off = entries.filter(([, m]) => m.status !== 'OK')

  return (
    <div className="body">
      <div className="navbar">
        <button className="icon" onClick={onBack}>
          ←
        </button>
        <span className="title">지표</span>
        <span className="icon" />
      </div>

      <h2 className="mid" style={{ marginBottom: 14 }}>
        숫자로 보는 우리
      </h2>

      <div className="scroll">
        <div className="stack">
          {ok.map(([k, m]) => {
            const out = renderMetric(k, (m as { value: unknown }).value)
            return (
              <div className="mcard" key={k}>
                <div className="cap">{METRIC_NAME[k] ?? k}</div>
                {out.kind === 'pair' ? (
                  <>
                    <div className="duo">
                      <span className="me">
                        {out.me}
                        {out.unit}
                        <em>나</em>
                      </span>
                      <span className="other">
                        <em>상대</em>
                        {out.other}
                        {out.unit}
                      </span>
                    </div>
                    <div className="mbar">
                      <i style={{ width: `${share(out.me, out.other)}%` }} />
                      <u />
                    </div>
                    {out.note && <div className="note">{out.note}</div>}
                  </>
                ) : (
                  <div className="note" style={{ fontSize: 15, color: 'var(--ink)', marginTop: 6 }}>
                    {out.text}
                  </div>
                )}
              </div>
            )
          })}

          {off.map(([k, m]) => (
            <div className="mcard locked" key={k}>
              <div className="cap">{METRIC_NAME[k] ?? k}</div>
              <div className="note">
                {m.status === 'LOCKED'
                  ? // 어느 쪽이 필요한지 갈린다 — 그림은 캡처에서만 나온다
                    (m as { missing: string[] }).missing.includes('affect')
                    ? '캡처를 올리면 열려요'
                    : '전체 대화 파일(txt)을 올리면 열려요'
                  : `조금 더 필요해요 (${Math.floor((m as { have: number }).have)} / ${(m as { need: number }).need})`}
              </div>
              {m.status === 'INSUFFICIENT' && (
                <div className="mini">
                  <i
                    style={{
                      width: `${Math.min(100, ((m as { have: number }).have / (m as { need: number }).need) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="footnote">
          이 수치는 메시지 패턴이며, 애정의 크기가 아니에요.
          <br />
          전화·만남·다른 메신저는 여기에 없어요.
        </div>
      </div>

      <div className="spacer" style={{ paddingTop: 16 }}>
        <button className="cta ghost" onClick={onBack}>
          결과로 돌아가기
        </button>
      </div>
    </div>
  )
}

function share(me: number, other: number): number {
  const t = Math.abs(me) + Math.abs(other)
  return t === 0 ? 50 : Math.round((Math.abs(me) / t) * 100)
}

const METRIC_NAME: Record<string, string> = {
  msgCount: '메시지 수',
  msgLength: '평균 길이',
  questionRate: '질문',
  syncAsym: '맞춰주는 정도',
  styleSep: '말투 차이',
  replyDist: '답장 속도',
  initiation: '선톡은 누가 먼저?',
  noReply: '읽고 답 없음',
  monthly: '월별 온도',
  changePoint: '식은 시점',
  phraseGap: '말버릇 대조',
  deletedCount: '지운 메시지',
  emojiAffect: '이모티콘 온도',
  emojiVariety: '이모티콘 다양도',
}
