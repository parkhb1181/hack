# 기울기

카카오톡 대화를 넣으면 어느 쪽으로 기울어 있는지 **−100 ~ +100 숫자 하나**로
보여준다.

## 넣을 수 있는 것

| 입력 | 어디서 | 비고 |
| --- | --- | --- |
| 캡처 `.png` `.jpg` | 스크롤하며 찍은 화면 여러 장 | 겹친 부분은 자동 병합 |
| 긴 캡처 한 장 | 스크롤 캡처 기능으로 통째로 찍은 것 | 3,000px마다 잘라 읽는다 (아래 참고) |
| `.txt` | 카카오톡 PC · 안드로이드 내보내기 | 제목 줄에서 본인을 자동 판정 |
| `.csv` | 카카오톡 iOS 내보내기 | 제목 줄이 없어 **본인을 직접 고른다** |

> **긴 캡처는 잘라서 읽는다.** PaddleOCR 검출은 긴 변을 제한 길이로 축소하므로,
> 이미지가 길수록 글자가 작아지다 어느 순간 아무것도 못 읽는다. 그런데 **에러가
> 아니라 빈 결과**로 나온다. 실측(630px 폭, 한글 줄 유지율):
>
> | 높이 | 자르기 전 | 자른 뒤 |
> | --- | --- | --- |
> | 3,974px | 100% · 20.7초 | 100% · 20.3초 |
> | 7,948px | 104% · 42.4초 | 102% · 42.1초 |
> | 15,896px | **87%** · 77초 | **101%** · 103초 |
> | 31,792px | **22%** · 22.7초 | — |
> | 63,584px | **0줄** · 1.0초 | — |
>
> 시간이 갑자기 **줄어드는 것**이 고장 신호였다 — 축소된 이미지에서 아무것도
> 못 찾으니 인식 단계가 통째로 생략된 것이다. `ocr_service/main.py`의
> `TILE_HEIGHT`가 이 경계를 강제한다.

셋 다 `lib/types.ts`의 `Msg[]`로 수렴하고, 그 아래로는 어떤 코드도 입력 종류를
보지 않는다. 같은 대화를 txt로 넣든 csv로 넣든 **숫자가 같다**(실측: 정보 단위
629.1 / 기울기 39 / 지표 10-14 동일).

경로 차이는 필드 결측으로만 남는다 — 캡처는 날짜가 없어 월별 지표가 잠기고,
파일은 그림이 없어 이모티콘 정서가 잠긴다.

---

## 폴더

```
docs/          설계 문서 — 코드보다 이쪽이 먼저다
  PRD.md         제품 정의. D1 시작 후 변경 금지
  SPEC.md        공식·파라미터·파서 규격. 수치는 여기서만 바꾼다
  MODELS.md      프롬프트 문구. 프롬프트는 여기서만 바꾼다
  TESTPLAN.md    하네스·체크리스트

lib/           엔진. 화면과 무관하게 혼자 돈다
  types.ts       Msg · Corpus · Report — 두 입력 경로가 만나는 공통 포맷
  corpus.ts      Msg[] → Corpus (버스트·세션·전환·가용 필드)
  report.ts      Corpus → Report (하드 플로어 판정 포함)
  text.ts        grapheme 기준 글자 수 — 이모지가 길이를 부풀리지 않게
  trace.ts       개발자 모드가 보는 추적 기록 + 원문 마스킹
  env.ts         .env.local 로더 (셸의 낡은 키를 덮어쓴다)

  parsers/       입력 → 공통 포맷
    txt.ts         내보내기 txt (PC/안드로이드)
    csv.ts         내보내기 csv (iOS) — txt와 같은 ParseResult로 수렴
    txt-worker.ts  대용량 txt 스트리밍 파싱
    ocr.ts         OCR 줄+좌표 → 말풍선·비텍스트 구간. 이 폴더에서 가장 크다
    ocr-client.ts  OCR 서비스 호출
    capture.ts     VLM 경로 어댑터

  metrics/       지표 14종. **mode를 보고 갈라지지 않는다**
    catalog.ts     지표 명세(등급·필요 필드·최소 표본)
    registry.ts    OK / LOCKED / INSUFFICIENT 판정
    basic.ts · temporal.ts · phrase.ts · affect.ts

  stats/         지표 → 화면에 나갈 숫자
    headline.ts    축 정규화 · 기울기 · 밴드
    crush.ts       썸 신호 요약 (기울기의 좌표 변환일 뿐)
    sample.ts      하드 플로어 · 축소 추정 · 정밀도 하향

  semantic/      임베딩 (로컬 Ollama bge-m3)
    ollama.ts      배치 임베딩 + 캐시
    metrics.ts     동조율 · 말투 분리도. **무작위 짝 기준선을 뺀다**

  vision/gemini.ts   비텍스트 조각의 정서 판독 (조각만 보낸다)
  llm/               해석 문단 하나
    interpret.ts     프롬프트 조립 + 호출
    verify.ts        응답의 숫자를 집계와 대조 — 못 어기는 경계
    figures.ts       파생 숫자의 단일 출처 (프롬프트·화면·검증이 같은 값을 본다)
    fallback.ts      검증 실패·타임아웃 시 쓰는 템플릿
  seed/              합성 대화 생성

app/           화면 (Next.js App Router)
  page.tsx           일반 모드
  dev/page.tsx       개발자 모드를 켠 채로 시작
  _components/       라우트가 아닌 것
  api/analyze/       캡처 → 리포트 한 방. Gemini 키가 클라이언트로 안 나간다
  globals.css        검정·흰색만

ocr_service/   PaddleOCR FastAPI 서비스 (Python 3.12, 포트 8756)

scripts/
  check/         정합성 검증 — 결과가 맞는지 대조한다
  bench/         실측 — 수치를 재서 선택의 근거를 만든다
  dev/           생성·눈으로 보기 (시드, 파이프라인, 진단)
  ocr/           파이썬 러너

tests/         vitest. 골든 파일은 fixtures/golden
fixtures/
  seeds/         합성 대화 (커밋됨)
  golden/        회귀 기준값 (커밋됨)
  render/        렌더 캡처 — .png/.ocr.json은 재생성 가능해 gitignore
  real/          실제 대화 — **절대 커밋하지 않는다** (gitignore)
```

임포트는 `@/` 별칭을 쓴다(`@/lib/parsers/ocr`). 같은 폴더 안만 `./`.

---

## 띄우기

OCR 서비스와 Ollama가 먼저 떠 있어야 한다. 둘 다 **로컬**이며, 대화 글자는
이 둘 밖으로 나가지 않는다.

```bash
.venv-paddle/Scripts/python.exe -m uvicorn ocr_service.main:app --port 8756
```

```bash
npm run dev
```

- 일반 모드 <http://localhost:3000>
- 개발자 모드 <http://localhost:3000/dev>

개발자 모드는 파싱 단계별 통과/탈락, 공통 포맷 `Msg[]`, 비전에 보낸 조각과 받은
JSON, 임베딩의 코사인 원값과 기준선, LLM에 보낸 집계 블록과 검증 결과를 전부
펼쳐 보여준다. **화면이 파이프라인을 재구현하지 않는다** — 실제로 도는 코드가
남긴 기록을 그릴 뿐이라, 여기 보이는 것과 실제 동작이 어긋나지 않는다.

---

## 밖으로 나가는 것

| 단계 | 어디로 | 무엇이 |
| --- | --- | --- |
| OCR | 로컬 8756 | 이미지 (기기 밖으로 안 나감) |
| 임베딩 | 로컬 Ollama | 대화 텍스트 (기기 밖으로 안 나감) |
| 비전 | Gemini | **조각 이미지만.** 글자 줄이 안 걸리도록 좁혀서 자른다 |
| 해석 | Gemini | **집계 숫자만.** 원문·말버릇·명장면은 안 보낸다 |

화자 이름은 파서 경계에서 `me`/`other`로 바뀌고 버려진다 — `Msg`에 이름 필드가
없다. 개발자 모드의 **원문 가리기** 토글은 화면 공유용이다.

---

## 어기면 안 되는 규칙

1. 지표 계산 코드에 `if (mode === 'capture')` 분기 금지. 경로 차이는 오직 필드 결측으로만 표현한다
2. 없는 축을 0으로 채우지 않는다. 0은 "균형"이라 결측이 방향을 왜곡한다
3. LLM은 숫자를 만들 수 없다. 응답의 수치는 집계와 코드로 대조하고 불일치 시 폴백한다
4. 성사 확률을 예측하지 않는다. 대화→결과 라벨 데이터셋이 없어 어떤 숫자도 근거를 못 댄다

---

## 명령

```bash
npm test
```

```bash
npm run typecheck
```
