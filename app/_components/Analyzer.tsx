'use client'

/**
 * 화면 하나에 두 모드가 산다.
 *
 * 일반 모드는 결과만 본다. 개발자 모드는 **같은 응답의 추적 기록**을 펼친다 —
 * 화면이 파이프라인을 다시 구현하지 않으므로, 여기 보이는 것이 실제로 돈 것이다.
 */

import { useCallback, useMemo, useRef, useState } from 'react'

import { maskTrace, type Trace } from '@/lib/trace'
import { CATALOG } from '@/lib/metrics/catalog'
import { bandLabel, WINDOW_MIN_FOR_NUMBER } from '@/lib/stats/headline'
import type { Odds } from '@/lib/stats/odds'
import { renderMetric } from '@/lib/stats/format'
import { HARD_FLOOR } from '@/lib/stats/sample'
import type { Band, HardFloor, Report, Stage } from '@/lib/types'

type Ok = {
  report: Report | HardFloor
  trace: Trace
  hardFloor: boolean
  odds: Odds[] | null
}
type Fail = {
  error: string
  /** CSV처럼 제목 줄이 없어 '나'를 특정 못 했을 때 */
  needsSpeaker?: boolean
  speakers?: Array<{ name: string; count: number }>
  trace?: Partial<Trace>
}

const STAGES: Array<[Stage, string]> = [
  ['crush', '썸'],
  ['couple', '연인'],
  ['friend', '친구'],
  ['family', '가족'],
  ['work', '업무'],
  ['unknown', '미지정'],
]

const LABEL = new Map(CATALOG.map((s) => [s.key, s.label]))

export default function Analyzer({ devDefault = false }: { devDefault?: boolean }) {
  const [files, setFiles] = useState<File[]>([])
  const [stage, setStage] = useState<Stage>('crush')
  const [dev, setDev] = useState(devDefault)
  const [mask, setMask] = useState(false)
  const [vision, setVision] = useState(true)
  const [embed, setEmbed] = useState(true)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<Ok | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState('parse')
  /** CSV처럼 제목 줄이 없는 형식은 누가 '나'인지 물어야 한다 — SPEC §3.10 */
  const [pick, setPick] = useState<Array<{ name: string; count: number }> | null>(null)
  const [me, setMe] = useState<string>('')
  const input = useRef<HTMLInputElement>(null)

  const isText = (f: File) => /\.(txt|csv)$/i.test(f.name) || f.type.startsWith('text/')
  const textFile = files.find(isText) ?? null

  const run = useCallback(
    async (meName?: string) => {
      if (files.length === 0) return
      setBusy(true)
      setErr(null)
      setRes(null)
      const fd = new FormData()

      // 대화 파일이 하나라도 있으면 그쪽이 우선이다. 두 다리를 섞어서 넣으면
      // 같은 대화인지 확인할 방법이 없다 — 겹침 병합은 캡처끼리만 성립한다.
      const t = files.find(isText)
      if (t) fd.append('file', t)
      else for (const f of files) fd.append('images', f)

      fd.append('stage', stage)
      fd.append('vision', vision ? 'on' : 'off')
      fd.append('embed', embed ? 'on' : 'off')
      if (meName) fd.append('me', meName)

      try {
        const r = await fetch('/api/analyze', { method: 'POST', body: fd })
        const j = (await r.json()) as Ok | Fail
        if (r.status === 409 && (j as Fail).needsSpeaker) {
          setPick((j as Fail).speakers ?? [])
          setMe((j as Fail).speakers?.[0]?.name ?? '')
          return
        }
        if (!r.ok || 'error' in j) {
          setErr((j as Fail).error ?? `실패 ${r.status}`)
        } else {
          setPick(null)
          setRes(j as Ok)
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : '요청 실패')
      } finally {
        setBusy(false)
      }
    },
    [files, stage, vision, embed],
  )

  // 마스킹은 표시 단계에서만 한다 — 지표는 이미 원문으로 계산돼 있다
  const trace = useMemo(() => {
    if (!res) return null
    return mask ? maskTrace(res.trace) : res.trace
  }, [res, mask])

  const report = res?.report
  const isFloor = res?.hardFloor === true

  return (
    <main>
      <header className="top">
        <h1>기울기</h1>
        <span className="sub">대화가 어느 쪽으로 기울어 있는지 하나의 숫자로</span>
        <span className="spacer" />
        <span
          className="toggle"
          data-on={dev}
          onClick={() => setDev((v) => !v)}
          role="button"
          tabIndex={0}
        >
          개발자 모드 {dev ? 'ON' : 'OFF'}
        </span>
      </header>

      <div className="controls">
        <label className="file">
          파일 고르기
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,.txt,.csv,text/plain,text/csv"
            multiple
            onChange={(e) => {
              setFiles([...(e.target.files ?? [])])
              setPick(null)
              setRes(null)
              setErr(null)
            }}
          />
        </label>
        <span className="dimtext">
          {files.length === 0
            ? '캡처(png·jpg) 또는 대화 파일(txt·csv)'
            : textFile
              ? `대화 파일 — ${textFile.name}`
              : `캡처 ${files.length}장 — ${files.map((f) => f.name).join(', ')}`}
        </span>
        <span className="spacer" style={{ flex: 1 }} />
        <select value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
          {STAGES.map(([v, l]) => (
            <option key={v} value={v}>
              관계: {l}
            </option>
          ))}
        </select>
        {/* 텍스트 파일에는 읽을 그림이 없다 — 토글을 띄우면 켤 수 있는 것처럼 보인다 */}
        {!textFile && (
          <span
            className="toggle"
            data-on={vision}
            onClick={() => setVision((v) => !v)}
            role="button"
          >
            비전 {vision ? 'ON' : 'OFF'}
          </span>
        )}
        <span className="toggle" data-on={embed} onClick={() => setEmbed((v) => !v)} role="button">
          임베딩 {embed ? 'ON' : 'OFF'}
        </span>
        {dev && (
          <span className="toggle" data-on={mask} onClick={() => setMask((v) => !v)} role="button">
            원문 가리기 {mask ? 'ON' : 'OFF'}
          </span>
        )}
        <button onClick={() => run()} disabled={busy || files.length === 0}>
          {busy ? '분석 중…' : '분석'}
        </button>
      </div>

      {err && <div className="err">{err}</div>}

      {/*
        제목 줄이 없는 형식(CSV)은 누가 '나'인지 알 수 없다.
        추측하면 기울기 **부호가 통째로 뒤집힌다** — 그래서 묻는다(SPEC §3.10).
      */}
      {pick && (
        <div className="headline">
          <div className="band">이 대화에서 본인은 누구인가요?</div>
          <div className="badge">
            파일에 &quot;○○ 님과 카카오톡 대화&quot; 같은 제목 줄이 없어 자동으로 못 정했습니다.
            잘못 고르면 기울기 방향이 반대로 나옵니다.
          </div>
          <div className="controls" style={{ marginTop: 16, marginBottom: 0 }}>
            <select value={me} onChange={(e) => setMe(e.target.value)}>
              {pick.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.count}건)
                </option>
              ))}
            </select>
            <button onClick={() => run(me)} disabled={busy || !me}>
              {busy ? '분석 중…' : '이 사람이 나입니다'}
            </button>
          </div>
        </div>
      )}

      {report && !isFloor && (
        <Headline report={report as Report} stage={stage} text={trace?.llm?.text ?? null} source={trace?.llm?.source ?? null} />
      )}
      {report && isFloor && (
        <div className="headline">
          <div className="band">
            정보가 부족합니다 — 정보 단위 {(report as HardFloor).infoUnits} / {HARD_FLOOR}
          </div>
          {(report as HardFloor).singleFact && (
            <div className="badge">확실히 말할 수 있는 것 하나 — {(report as HardFloor).singleFact}</div>
          )}
        </div>
      )}

      {res?.odds && <OddsCards odds={res.odds} />}

      {report && !isFloor && <Metrics report={report as Report} />}

      {dev && trace && (
        <>
          <div className="tabs" style={{ marginTop: 26 }}>
            {[
              ['parse', '파싱'],
              ['format', '공통 포맷'],
              ['vision', '비전'],
              ['embed', '임베딩'],
              ['llm', 'LLM'],
              ['raw', '원 응답'],
            ].map(([k, l]) => (
              <button key={k} data-on={tab === k} onClick={() => setTab(k)}>
                {l}
              </button>
            ))}
          </div>
          {tab === 'parse' && <ParseView trace={trace} />}
          {tab === 'format' && <FormatView trace={trace} />}
          {tab === 'vision' && <VisionView trace={trace} />}
          {tab === 'embed' && <EmbedView trace={trace} />}
          {tab === 'llm' && <LlmView trace={trace} />}
          {tab === 'raw' && (
            <section className="dev">
              <h2>
                응답 계약 <span className="n">SPEC §11</span>
              </h2>
              <div className="body">
                <pre>{JSON.stringify(report, null, 2)}</pre>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  )
}

/* ------------------------------ 헤드라인 ------------------------------ */

function Headline({
  report,
  stage,
  text,
  source,
}: {
  report: Report
  stage: Stage
  text: string | null
  source: 'llm' | 'fallback' | null
}) {
  const h = report.headline
  // -100..+100 → 0..100%
  const pos = ((h.tilt + 100) / 200) * 100
  const label = bandLabel(h.band as Band, stage)

  // SPEC §7.3 — 표본이 얇으면 **숫자를 숨기고 밴드 라벨만** 보여준다.
  // 세션 몇 개로 뽑은 값에 `+30`을 붙이는 것은 없는 정밀도를 주장하는 것이다.
  // 하한을 10으로 내린 뒤로는 이쪽이 기본 경로다 — 여기가 유일한 방어선이다.
  if (h.precisionReduced) {
    return (
      <>
        <div className="headline">
          <div className="band" style={{ fontSize: 24, marginTop: 0, lineHeight: 1.35 }}>
            {label}
          </div>
          <div className="badge">
            최근 {report.windowFilled}개 메시지 · 정보 단위 {report.infoUnits} · 근거 축{' '}
            {h.axesUsed}/{h.axesTotal}
            {report.gaps.length ? ` · 결측 ${report.gaps.join(', ')}` : ''}
          </div>
          <div className="bar">
            <div className="zero" />
            <div className="mark" style={{ left: `${pos}%` }} />
            <div className="ends">
              <span>상대</span>
              <span>당신</span>
            </div>
          </div>
          <div className="badge" style={{ marginTop: 12 }}>
            표본이 얇아 숫자는 표시하지 않습니다 — 방향만 읽어주세요 (SPEC §6.4).
            메시지 {WINDOW_MIN_FOR_NUMBER}개부터 숫자가 나옵니다.
          </div>
        </div>
        {text && (
          <div className="para">
            <span className="from">{source === 'llm' ? 'LLM 해석' : '폴백 템플릿'}</span>
            {text}
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <div className="headline">
        <div className="tilt">
          {h.tilt > 0 ? '+' : ''}
          {h.tilt}
          <span className="unit">
            {h.axesUsed}/{h.axesTotal}축
          </span>
        </div>
        <div className="band">{label}</div>
        <div className="badge">
          최근 {report.windowFilled}개 메시지 · 정보 단위 {report.infoUnits}
          {report.gaps.length ? ` · 결측 ${report.gaps.join(', ')}` : ''}
        </div>
        <div className="bar">
          <div className="zero" />
          <div className="mark" style={{ left: `${pos}%` }} />
          <div className="ends">
            <span>상대 −100</span>
            <span>+100 당신</span>
          </div>
        </div>
      </div>
      {text && (
        <div className="para">
          <span className="from">{source === 'llm' ? 'LLM 해석' : '폴백 템플릿'}</span>
          {text}
        </div>
      )}
    </>
  )
}

/**
 * 퍼센트 카드 — SPEC §7.3.3
 *
 * **숫자만 크게 띄우면 안 된다.** 이 값은 예측이 아니라 지표의 가중 평균이라,
 * 구성 요소를 접어두면 근거 없는 점괘와 구분되지 않는다. 그래서 축·가중치·
 * 출처를 항상 함께 펴 둔다 — 접는 UI를 쓰지 않은 것이 의도다.
 */
function OddsCards({ odds }: { odds: Odds[] }) {
  return (
    <div style={{ marginTop: 22 }}>
      {odds.map((o) => (
        <section className="dev" key={o.key} style={{ marginTop: 14 }}>
          <h2>
            {o.label}
            <span className="faint">
              축 {o.used}/{o.total}
              {o.coarse ? ' · 표본이 얇아 5단위로 표시' : ''}
            </span>
          </h2>
          <div className="body">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
              <div className="tilt" style={{ fontSize: 44 }}>
                {o.coarse ? o.percent : o.percent.toFixed(1)}
                <span className="unit">/ 100</span>
              </div>
              <div className="bar" style={{ flex: 1, minWidth: 220 }}>
                <div className="zero" />
                <div className="mark" style={{ left: `${o.percent}%` }} />
                <div className="ends">
                  <span>0</span>
                  <span>100</span>
                </div>
              </div>
            </div>

            <table style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th>구성 축</th>
                  <th>값</th>
                  <th>가중치</th>
                  <th className="grow">어디서 나온 숫자인가</th>
                </tr>
              </thead>
              <tbody>
                {o.parts.map((p) => (
                  <tr key={p.key}>
                    <td>{p.label}</td>
                    <td>{Math.round(p.value * 100)}</td>
                    <td className="dimtext">×{p.weight}</td>
                    <td className="grow faint">{p.from}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="badge" style={{ marginTop: 12 }}>
              {o.disclaimer}
              {o.used < o.total && (
                <>
                  {' '}
                  빠진 축 {o.total - o.used}개는 <b>0으로 채우지 않고</b> 가중치에서 뺐습니다.
                </>
              )}
            </div>
          </div>
        </section>
      ))}
    </div>
  )
}

/* ------------------------------ 지표 카드 ------------------------------ */

/** 두 값의 상대 비율로 막대를 채운다 — 어느 쪽이 큰지가 한눈에 보여야 한다 */
function PairBar({ me, other }: { me: number; other: number }) {
  const a = Math.abs(me)
  const b = Math.abs(other)
  const sum = a + b
  const left = sum === 0 ? 50 : (a / sum) * 100
  return (
    <div className="pairbar">
      <div className="side me" style={{ width: `${left}%` }} />
      <div className="side other" style={{ width: `${100 - left}%` }} />
    </div>
  )
}

function Metrics({ report }: { report: Report }) {
  return (
    <div className="cards">
      {Object.entries(report.metrics).map(([k, r]) => {
        const label = LABEL.get(k) ?? k
        if (r.status !== 'OK') {
          return (
            <div key={k} className="card" data-status={r.status}>
              <div className="k">{label}</div>
              <div className="v">
                {r.status === 'LOCKED'
                  ? `잠김 — ${r.missing.join(', ')} 필요`
                  : `표본 부족 — ${r.have}/${r.need}`}
              </div>
            </div>
          )
        }

        const out = renderMetric(k, r.value)
        return (
          <div key={k} className="card" data-status="OK">
            <div className="k">{label}</div>
            {out.kind === 'pair' ? (
              <>
                <div className="duo">
                  <span>
                    <b>{out.me}</b>
                    {out.unit}
                    <em>나</em>
                  </span>
                  <span>
                    <b>{out.other}</b>
                    {out.unit}
                    <em>상대</em>
                  </span>
                </div>
                <PairBar me={out.me} other={out.other} />
                {out.note && <div className="note-s">{out.note}</div>}
              </>
            ) : (
              <div className="v">{out.text}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------ 개발자 모드 ------------------------------ */

function ParseView({ trace }: { trace: Trace }) {
  if (trace.text) return <TextParseView t={trace.text} />
  return (
    <>
      <div className="note">
        OCR은 <b>로컬 서비스(127.0.0.1:8756)</b>에서만 돈다. 대화 글자는 이 단계에서 밖으로 나가지 않는다.
      </div>
      {trace.pages.map((p) => (
        <section className="dev" key={p.label}>
          <h2>
            {p.label} <span className="n">{p.width}×{p.height}</span>
            <span className="faint">
              OCR {p.ocrSec != null ? `${p.ocrSec.toFixed(2)}초` : '?'} · 화자 {p.speakers}명
              {p.rejected ? ` · 거절(${p.rejected})` : ''}
            </span>
          </h2>
          <div className="body">
            <div className="flow" style={{ marginBottom: 16 }}>
              {p.filters.map((f) => (
                <div className="step" key={f.name}>
                  <div className="n">{f.kept}</div>
                  <div className="l">{f.name}</div>
                  <div className="d">{f.dropped.length ? `−${f.dropped.length}` : ' '}</div>
                </div>
              ))}
              <div className="step">
                <div className="n">{p.bubbles.length}</div>
                <div className="l">말풍선</div>
                <div className="d">+{p.holes.length} 비텍스트</div>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>y</th>
                  <th>x</th>
                  <th>쪽</th>
                  <th>시각</th>
                  <th className="grow">본문</th>
                </tr>
              </thead>
              <tbody>
                {p.bubbles.map((b, i) => (
                  <tr key={i}>
                    <td className="faint">{b.box[1]}</td>
                    <td className="faint">{b.box[0]}</td>
                    <td>{b.who === 'me' ? '나' : '상대'}</td>
                    <td className="dimtext">{b.time ?? '—'}</td>
                    <td className="grow">{b.text.replace(/\n/g, ' ⏎ ')}</td>
                  </tr>
                ))}
                {p.holes.map((h, i) => (
                  <tr key={`h${i}`}>
                    <td className="faint">{h.y[0]}</td>
                    <td className="faint">—</td>
                    <td>{h.who === 'me' ? '나' : '상대'}</td>
                    <td className="dimtext">{h.time ?? '—'}</td>
                    <td className="grow dimtext">
                      〈비텍스트 {h.y[1] - h.y[0]}px · 확신 {h.confidence}〉
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {p.filters.some((f) => f.dropped.length > 0) && (
              <>
                <div className="k" style={{ marginTop: 18, marginBottom: 6 }}>
                  <span className="dimtext">걸러낸 줄 — 왜 버렸는지</span>
                </div>
                <table>
                  <tbody>
                    {p.filters.flatMap((f) =>
                      f.dropped.map((d, i) => (
                        <tr key={`${f.name}${i}`}>
                          <td className="faint">
                            {d.box[0]},{d.box[1]}
                          </td>
                          <td className="strike grow">{d.text}</td>
                          <td className="dimtext">{d.why}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </section>
      ))}
    </>
  )
}

const SOURCE_LABEL: Record<string, string> = {
  kakao_pc: '카카오톡 PC 내보내기',
  kakao_android: '카카오톡 안드로이드 내보내기',
  kakao_ios: '카카오톡 iOS 내보내기 (CSV)',
  unknown: '알 수 없음',
}

function TextParseView({ t }: { t: NonNullable<Trace['text']> }) {
  return (
    <>
      <div className="note">
        파일은 <b>브라우저에서 서버로만</b> 간다. 파싱은 전부 이 안에서 끝나고 원문은 어디에도
        저장되지 않는다 — 서버는 무상태다(PRD §7.2). 화자 표시명은 아래 표가 마지막이고,
        공통 포맷으로 넘어갈 때 <code>me</code> / <code>other</code>로 바뀌며 버려진다.
      </div>
      <section className="dev">
        <h2>
          {t.label} <span className="n">{t.kind.toUpperCase()}</span>
          <span className="faint">
            {SOURCE_LABEL[t.source] ?? t.source} · {(t.bytes / 1024).toFixed(1)}KB
          </span>
        </h2>
        <div className="body">
          <div className="flow">
            <div className="step">
              <div className="n">{t.records}</div>
              <div className="l">읽어낸 메시지</div>
            </div>
            <div className="step">
              <div className="n">{t.deleted}</div>
              <div className="l">삭제 메시지</div>
              <div className="d">개수만 셈 · §3.9</div>
            </div>
            <div className="step">
              <div className="n">{t.system}</div>
              <div className="l">시스템 메시지</div>
              <div className="d">제외</div>
            </div>
            <div className="step">
              <div className="n">{t.unparsed}</div>
              <div className="l">못 읽은 줄</div>
              <div className="d">0이어야 정상</div>
            </div>
          </div>

          <table style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>화자</th>
                <th>메시지</th>
                <th>처음</th>
                <th className="grow">마지막</th>
              </tr>
            </thead>
            <tbody>
              {t.speakers.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td>{s.count}</td>
                  <td className="dimtext">{s.firstDate ?? '—'}</td>
                  <td className="grow dimtext">{s.lastDate ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="badge" style={{ marginTop: 12 }}>
            본인 판정:{' '}
            {t.resolvedBy === 'title'
              ? '제목 줄에서 자동 확정'
              : t.resolvedBy === 'user'
                ? '사용자가 직접 선택'
                : '미확정'}
            {t.rejected ? ` · 거절(${t.rejected})` : ''}
          </div>
        </div>
      </section>
      <section className="dev">
        <h2>왜 삭제 메시지를 시간축에 안 넣는가</h2>
        <div className="body">
          <pre className="wrap">
{`"삭제된 메시지입니다"는 타임스탬프는 있지만 내용이 없다.
그 자리를 메시지로 세면 분량·응답 지연이 오염되고,
빼면 앞뒤가 한 버스트로 잘못 합쳐진다.

그래서 배열에서 빼되 개수는 센다 (SPEC §3.9).
지표 하나(삭제 메시지 수)로만 쓰고 나머지 계산에서는 없는 것으로 둔다.`}
          </pre>
        </div>
      </section>
    </>
  )
}

function FormatView({ trace }: { trace: Trace }) {
  const all = trace.corpus.messages
  return (
    <>
      <div className="note">
        두 입력 경로(캡처 · txt)가 여기서 만난다. 이 아래로는 어떤 코드도 <b>mode를 보고 갈라지지 않는다</b>.
        지표는 이 배열만 본다.
      </div>
      <section className="dev">
        <h2>
          겹침 병합 <span className="n">SPEC §4.2</span>
        </h2>
        <div className="body">
          {!trace.merge ? (
            <span className="dimtext">
              대화 파일은 한 덩어리로 들어오므로 겹침이 없다. 병합은 스크롤하며 찍은 캡처끼리만
              성립한다.
            </span>
          ) : (
            <div className="flow">
              <div className="step">
                <div className="n">{trace.merge.pages}</div>
                <div className="l">이미지</div>
              </div>
              <div className="step">
                <div className="n">{trace.merge.before}</div>
                <div className="l">병합 전</div>
              </div>
              <div className="step">
                <div className="n">−{trace.merge.removed}</div>
                <div className="l">중복 제거</div>
              </div>
              <div className="step">
                <div className="n">{trace.merge.after}</div>
                <div className="l">병합 후</div>
              </div>
            </div>
          )}
          <div className="flow" style={{ marginTop: 10 }}>
            <div className="step">
              <div className="n">{trace.corpus.windowFilled}</div>
              <div className="l">판독 창</div>
            </div>
            <div className="step">
              <div className="n">{trace.corpus.infoUnits}</div>
              <div className="l">정보 단위</div>
              <div className="d">하한 {HARD_FLOOR}</div>
            </div>
            <div className="step">
              <div className="n">{trace.corpus.availableFields.length}</div>
              <div className="l">가용 필드</div>
              <div className="d">{trace.corpus.availableFields.join(' ')}</div>
            </div>
          </div>
        </div>
      </section>
      <section className="dev">
        <h2>
          공통 포맷 <span className="n">Msg[]</span>
          <span className="faint">
            {all.length}건 표시
            {trace.corpus.truncated > 0 ? ` · 뒤 ${trace.corpus.truncated}건 생략(표시용)` : ''}
          </span>
        </h2>
        <div className="body">
          <pre>{JSON.stringify(all, null, 2)}</pre>
        </div>
      </section>
    </>
  )
}

function VisionView({ trace }: { trace: Trace }) {
  const v = trace.vision
  if (!v) return <div className="note">비전을 끄고 돌렸습니다.</div>
  return (
    <>
      <div className="note">
        밖으로 나가는 것은 <b>조각뿐</b>이다. 조각은 말풍선 <b>사이</b> 여백에서 잘라내며,
        글자 줄이 하나도 안 걸리도록 좁혀 둔다 —{' '}
        <b>구간 안 글자 {v.enclosedTextLines}줄</b> (0이어야 정상).
      </div>
      <section className="dev">
        <h2>
          보낸 조각 <span className="n">{v.crops.length}개 · {v.model}</span>
          {v.skipped?.length > 0 && (
            <span className="faint">
              건너뜀 {v.skipped.map((s) => `${s.model}(${s.why})`).join(', ')}
            </span>
          )}
        </h2>
        <div className="body">
          <table>
            <thead>
              <tr>
                <th>이미지</th>
                <th>y 구간</th>
                <th>크기</th>
              </tr>
            </thead>
            <tbody>
              {v.crops.map((c, i) => (
                <tr key={i}>
                  <td>{c.page}</td>
                  <td className="faint">
                    {c.y[0]} ~ {c.y[1]}
                  </td>
                  <td className="dimtext">
                    {c.width}×{c.height}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {v.crops.length === 0 && <span className="dimtext">비텍스트 구간이 없어 호출하지 않았습니다.</span>}
        </div>
      </section>
      <section className="dev">
        <h2>보낸 프롬프트</h2>
        <div className="body">
          <pre className="wrap">{v.prompt}</pre>
        </div>
      </section>
      <section className="dev">
        <h2>
          받은 JSON <span className="n">검증 통과 {v.items.length}건</span>
          {v.error && <span className="faint">오류: {v.error}</span>}
        </h2>
        <div className="body">
          <pre>{JSON.stringify(v.items, null, 2)}</pre>
          {v.error && (
            <div className="note" style={{ marginTop: 12, marginBottom: 0 }}>
              비전이 실패하면 해당 발화는 <b>nontext로 남고 C급 지표만 잠긴다</b>. 헤드라인은 영향받지 않는다 (SPEC §9.3).
            </div>
          )}
        </div>
      </section>
    </>
  )
}

function EmbedView({ trace }: { trace: Trace }) {
  const s = trace.semantic
  if (!s) return <div className="note">임베딩을 끄고 돌렸습니다.</div>
  if (s.error) {
    return (
      <>
        <div className="err">임베딩 실패 — {s.error}</div>
        <div className="note">
          동조율·말투 지표만 <b>LOCKED</b>가 되고 헤드라인은 남은 축으로 계속 나옵니다.
          <b> 없는 축을 0으로 채우지 않습니다</b> — 0은 &quot;균형&quot;이라 결측이 방향을 왜곡합니다.
        </div>
        <div className="note">Ollama가 떠 있는지 확인하세요: <code>ollama serve</code></div>
      </>
    )
  }

  const row = (k: string, me: number | null | undefined, other: number | null | undefined) => (
    <tr>
      <td className="dimtext">{k}</td>
      <td>{me ?? '—'}</td>
      <td>{other ?? '—'}</td>
    </tr>
  )

  return (
    <>
      <div className="note">
        <b>0~1.0 코사인은 이 표의 첫 줄입니다.</b> 그런데 그 값만 보면 안 됩니다 — 어떤 대화든
        0.6~0.7에 몰려서 모든 관계가 똑같아 보입니다. <b>무작위 짝 기준선을 빼야</b> 의미가 생기고,
        지표에 실제로 쓰이는 것은 감산 후 값입니다.
      </div>
      <section className="dev">
        <h2>
          동조율 <span className="n">{s.model}</span>
          <span className="faint">
            {s.embedded}건 임베딩 (건너뜀 {s.skipped} · 캐시 {s.cacheHits}) · 전환 쌍 {s.pairs} ·{' '}
            {s.elapsedMs}ms
          </span>
        </h2>
        <div className="body">
          <table>
            <thead>
              <tr>
                <th>단계</th>
                <th>당신</th>
                <th>상대</th>
              </tr>
            </thead>
            <tbody>
              {row('코사인 원값 (0~1)', s.raw?.me, s.raw?.other)}
              {row('무작위 짝 기준선', s.baseline?.me, s.baseline?.other)}
              {row('감산 후 = 지표값', s.net?.me, s.net?.other)}
            </tbody>
          </table>
          <div className="flow" style={{ marginTop: 14 }}>
            <div className="step">
              <div className="n">{s.axis ?? '—'}</div>
              <div className="l">동조 축</div>
              <div className="d">−1 ~ +1</div>
            </div>
            <div className="step">
              <div className="n">{s.styleSep ?? '—'}</div>
              <div className="l">말투 분리도</div>
              <div className="d">0~100 · 대칭 지표</div>
            </div>
          </div>
        </div>
      </section>
      <section className="dev">
        <h2>왜 코사인만으로는 못 쓰는가</h2>
        <div className="body">
          <pre className="wrap">
{`코사인은 "얼마나 비슷한 말인가"를 잽니다. "좋아한다"를 재지 않습니다.
실측: 싸우는 대화가 0.703, 다정한 대화가 0.619 — 싸움이 더 높습니다.
서로 같은 화제로 맞받아치기 때문입니다.

그래서 이 값은 호감도가 아니라 동조율(맞춰주는 정도)로만 씁니다.
두 사람의 차이만 축으로 쓰고, 절대값은 화면에 내보내지 않습니다.`}
          </pre>
        </div>
      </section>
    </>
  )
}

function LlmView({ trace }: { trace: Trace }) {
  const l = trace.llm
  if (!l) {
    const u = trace.corpus.infoUnits
    const short = u < HARD_FLOOR
    return (
      <>
        <div className="note">
          {short ? (
            <>
              LLM을 돌리지 않았습니다 — <b>정보가 부족해서</b>입니다.
              정보 단위 <b>{u} / {HARD_FLOOR}</b> (메시지 {trace.corpus.windowFilled}건).
              하한에 못 미치면 해석 문단을 만들지 않습니다. 지표 몇 개짜리 결과에 문장을 붙이면
              근거보다 말이 앞섭니다(SPEC §6.2).
            </>
          ) : (
            <>LLM을 끄고 돌렸습니다. 정보 단위는 {u} / {HARD_FLOOR}로 충분합니다.</>
          )}
        </div>
        {short && (
          <section className="dev">
            <h2>
              얼마나 더 필요한가 <span className="n">SPEC §6.1</span>
            </h2>
            <div className="body">
              <div className="flow">
                <div className="step">
                  <div className="n">{u}</div>
                  <div className="l">지금</div>
                  <div className="d">{trace.corpus.windowFilled}건</div>
                </div>
                <div className="step">
                  <div className="n">{Math.max(0, Math.round((HARD_FLOOR - u) * 10) / 10)}</div>
                  <div className="l">모자란 양</div>
                </div>
                <div className="step">
                  <div className="n">
                    ~{Math.ceil((HARD_FLOOR - u) / Math.max(0.4, u / Math.max(1, trace.corpus.windowFilled)))}
                  </div>
                  <div className="l">더 필요한 메시지</div>
                  <div className="d">지금 대화 밀도 기준</div>
                </div>
              </div>
              <pre className="wrap" style={{ marginTop: 12 }}>
{`정보 단위는 메시지 개수가 아니라 가중치 합이다 (SPEC §6.1).
  10자 이상 1.0   3~9자 0.7   2자 이하 0.4
  이모티콘(정서 판독됨) 1.2   사진 0.3   판독 전 0.1

단답 60개와 문장 25개의 정보량이 실제로 다르기 때문이다.
캡처라면 보통 4~5장에서 하한을 넘는다.`}
              </pre>
            </div>
          </section>
        )}
      </>
    )
  }
  const v = l.verify as { ok?: boolean; badNumbers?: string[]; violations?: unknown[]; sentences?: number } | null
  return (
    <>
      <div className="note">
        LLM에 가는 것은 <b>집계 숫자뿐</b>이다. 대화 원문·말버릇·명장면은 보내지 않는다 (MODELS §4.1).
        아래 블록을 그대로 읽어보면 문장이 하나도 없다는 것을 확인할 수 있다.
      </div>
      <section className="dev">
        <h2>
          결과 <span className="n">{l.source === 'llm' ? 'LLM 채택' : '폴백'}</span>
          <span className="faint">
            {l.model} · {l.elapsedMs}ms
            {l.skipped?.length
              ? ` · 건너뜀 ${l.skipped.map((s) => `${s.model}(${s.why})`).join(', ')}`
              : ''}
            {l.reason ? ` · 사유: ${l.reason}` : ''}
          </span>
        </h2>
        <div className="body">
          <pre className="wrap">{l.text}</pre>
          {v && (
            <table style={{ marginTop: 12 }}>
              <tbody>
                <tr>
                  <td className="dimtext">검증</td>
                  <td>{v.ok ? '통과' : '실패'}</td>
                </tr>
                <tr>
                  <td className="dimtext">집계에 없는 숫자</td>
                  <td>{v.badNumbers?.length ? v.badNumbers.join(', ') : '없음'}</td>
                </tr>
                <tr>
                  <td className="dimtext">금지 표현</td>
                  <td>{v.violations?.length ? JSON.stringify(v.violations) : '없음'}</td>
                </tr>
                <tr>
                  <td className="dimtext">문장 수</td>
                  <td>{v.sentences}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </section>
      <section className="dev">
        <h2>보낸 집계 블록</h2>
        <div className="body">
          <pre>{l.block}</pre>
        </div>
      </section>
      <section className="dev">
        <h2>시스템 프롬프트</h2>
        <div className="body">
          <pre className="wrap">
            {l.system}
            {'\n\n'}
            {l.stageLine}
          </pre>
        </div>
      </section>
      <section className="dev">
        <h2>단계별 소요</h2>
        <div className="body">
          <div className="flow">
            {Object.entries(trace.timings).map(([k, ms]) => (
              <div className="step" key={k}>
                <div className="n">{ms}</div>
                <div className="l">{k} (ms)</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}

