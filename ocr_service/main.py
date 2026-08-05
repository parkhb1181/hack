"""OCR 서비스 — 이미지 → 텍스트 줄 + 좌표

PaddleOCR은 Python 전용이고 모델 로드에 약 3.8초가 든다. 요청마다 프로세스를
띄우면 그 비용을 매번 낸다. 여기서는 프로세스가 살아 있는 동안 모델을 상주시킨다.

  로컬 실행:
    .venv-paddle\\Scripts\\python.exe -m uvicorn ocr_service.main:app --port 8756

응답 형태는 scripts/ocr/run_ocr_paddle.py와 동일하다 — TS 어댑터(lib/parsers/ocr.ts)가
그대로 받아 쓴다.
"""

from __future__ import annotations

import io
import os
import re
import time
from contextlib import asynccontextmanager
from typing import Any

# oneDNN 커널이 이 빌드에서 PIR 속성 변환에 실패한다. 반드시 import 전에 꺼야 한다.
os.environ.setdefault("FLAGS_use_mkldnn", "0")

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image

# 검출/인식 모델을 **함께** 못 박는다.
# 검출만 지정하면 PaddleOCR이 lang 기반 기본값 적용을 멈추고 인식 모델을
# 중국어 기본값으로 되돌린다(실측: 한글이 전부 빈 문자열로 나옴).
DET_MODEL = os.environ.get("OCR_DET_MODEL", "PP-OCRv5_mobile_det")
REC_MODEL = os.environ.get("OCR_REC_MODEL", "korean_PP-OCRv5_mobile_rec")

MAX_BYTES = 12 * 1024 * 1024
ALLOWED = {"image/png", "image/jpeg", "image/webp"}

_state: dict[str, Any] = {}


def _build_engine():
    from paddleocr import PaddleOCR

    return PaddleOCR(
        lang="korean",
        text_detection_model_name=DET_MODEL,
        text_recognition_model_name=REC_MODEL,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        enable_mkldnn=False,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    started = time.time()
    _state["engine"] = _build_engine()
    _state["load_sec"] = round(time.time() - started, 2)
    yield
    _state.clear()


app = FastAPI(title="gieulgi OCR", lifespan=lifespan)


# PaddleOCR은 'ㅜㅜㅜ'를 'TTT'로 오인식한다. 개수를 유지하며 되돌린다.
# 앞뒤에 알파벳이 있으면 영문 단어이므로 건드리지 않는다.
_JAMO = re.compile(r"(?<![A-Za-z])T{2,}(?![A-Za-z])")


def fix_jamo(text: str) -> str:
    return _JAMO.sub(lambda m: "ㅜ" * len(m.group()), text)


# 한 번에 넘길 수 있는 최대 높이(px).
#
# ⚠️ **이 값을 넘기면 조용히 실패한다.** PaddleOCR 검출은 긴 변을 제한 길이에
# 맞춰 축소하므로, 이미지가 길수록 글자가 작아지다가 어느 순간 아무것도 못 읽는다.
# 에러가 아니라 **빈 결과**로 나오는 것이 위험하다. 실측(630px 폭, 한글 줄 유지율):
#
#     3,974px 100%  20.7초        31,792px  22%  22.7초   ← 빨라지는 게 신호다
#     7,948px 104%  42.4초        63,584px   0%   1.0초   ← 200 OK에 줄 0개
#    15,896px  87%  77.0초
#
# 8,000px까지는 멀쩡했다. 절반 아래로 잡아 여유를 둔다.
TILE_HEIGHT = 3000
# 조각 경계에 걸친 줄은 양쪽에서 반쪽씩 잘린다. 겹쳐 자르고 나중에 합친다.
TILE_OVERLAP = 300


def _predict(array, y_offset: int) -> list[dict[str, Any]]:
    """한 조각을 읽고, 좌표를 원본 기준으로 되돌린다"""
    out: list[dict[str, Any]] = []
    for page in _state["engine"].predict(array):
        d = page.json["res"] if hasattr(page, "json") else page
        polys = d.get("rec_polys") or d.get("dt_polys") or []
        texts = d.get("rec_texts") or []
        scores = d.get("rec_scores") or []
        for poly, text, score in zip(polys, texts, scores):
            xs = [float(p[0]) for p in poly]
            ys = [float(p[1]) for p in poly]
            out.append(
                {
                    "text": fix_jamo(text),
                    "box": [
                        round(min(xs)),
                        round(min(ys)) + y_offset,
                        round(max(xs)),
                        round(max(ys)) + y_offset,
                    ],
                    "confidence": round(float(score), 4),
                }
            )
    return out


def _dedupe(lines: list[dict[str, Any]], tol: int = 12) -> list[dict[str, Any]]:
    """겹친 구간에서 두 번 읽힌 줄을 하나로 합친다.

    같은 글자가 비슷한 자리에 있으면 같은 줄로 본다. 조각 경계에서 반쪽만
    잡힌 줄은 반대편 조각이 온전히 잡으므로, **신뢰도가 높은 쪽**을 남긴다.
    """
    kept: list[dict[str, Any]] = []
    for l in sorted(lines, key=lambda x: -x["confidence"]):
        t = l["text"].strip()
        dup = False
        for k in kept:
            if k["text"].strip() != t:
                continue
            if abs(k["box"][1] - l["box"][1]) <= tol and abs(k["box"][0] - l["box"][0]) <= tol:
                dup = True
                break
        if not dup:
            kept.append(l)
    return kept


def _extract(image_bytes: bytes) -> dict[str, Any]:
    import numpy as np

    with Image.open(io.BytesIO(image_bytes)) as im:
        im = im.convert("RGB")
        width, height = im.size
        # PaddleOCR은 numpy 입력을 **BGR**(OpenCV 관례)로 읽는다.
        # RGB를 그대로 넘기면 채널이 뒤바뀌어 검출 결과가 달라진다
        # (실측: 작은 글자 'ㅅㅂ'을 놓치고 없던 노이즈가 생겼다).
        full = np.array(im)[:, :, ::-1]

    started = time.time()

    if height <= TILE_HEIGHT:
        lines = _predict(full, 0)
        tiles = 1
    else:
        # 스크롤 캡처를 통째로 넣는 경우다. 잘라서 읽고 좌표를 되돌린다.
        step = TILE_HEIGHT - TILE_OVERLAP
        lines = []
        tiles = 0
        y = 0
        while y < height:
            bottom = min(height, y + TILE_HEIGHT)
            lines.extend(_predict(full[y:bottom], y))
            tiles += 1
            if bottom >= height:
                break
            y += step
        lines = _dedupe(lines)

    lines.sort(key=lambda l: (l["box"][1], l["box"][0]))
    return {
        "width": width,
        "height": height,
        "lines": lines,
        "tiles": tiles,
        "elapsed_sec": round(time.time() - started, 3),
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": "engine" in _state,
        "det": DET_MODEL,
        "rec": REC_MODEL,
        "load_sec": _state.get("load_sec"),
    }


@app.post("/crop")
async def crop(
    file: UploadFile = File(...),
    bands: str = Form(...),
) -> dict[str, Any]:
    """세로 구간들을 잘라 base64 PNG로 돌려준다.

    비텍스트 발화(스티커·사진)의 자리만 오려서 Vision에 보내기 위한 것이다.
    조각에는 대화 글자가 없으므로 대화 내용이 외부로 나가지 않는다(MODELS §2.2).

    bands: JSON 배열 `[[y0, y1], ...]`
    """
    import base64
    import json as _json

    if file.content_type not in ALLOWED:
        raise HTTPException(415, f"지원하지 않는 형식: {file.content_type}")

    try:
        ranges = _json.loads(bands)
        pairs = [(int(a), int(b)) for a, b in ranges]
    except Exception as e:
        raise HTTPException(400, "bands 형식 오류 — [[y0,y1], ...]") from e

    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "이미지가 너무 큽니다")

    out: list[dict[str, Any]] = []
    with Image.open(io.BytesIO(data)) as im:
        im = im.convert("RGB")
        w, h = im.size
        for y0, y1 in pairs:
            top = max(0, min(h, y0))
            bottom = max(top + 1, min(h, y1))
            piece = im.crop((0, top, w, bottom))
            buf = io.BytesIO()
            piece.save(buf, format="PNG")
            out.append(
                {
                    "y": [top, bottom],
                    "width": piece.width,
                    "height": piece.height,
                    "png_base64": base64.b64encode(buf.getvalue()).decode("ascii"),
                }
            )

    return {"crops": out}


@app.post("/ocr")
async def ocr(file: UploadFile = File(...)) -> dict[str, Any]:
    if file.content_type not in ALLOWED:
        raise HTTPException(415, f"지원하지 않는 형식: {file.content_type}")

    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, f"이미지가 너무 큽니다 ({len(data)} bytes)")
    if not data:
        raise HTTPException(400, "빈 파일")

    try:
        return _extract(data)
    except Exception as e:  # 스택트레이스를 클라이언트에 노출하지 않는다
        raise HTTPException(500, f"OCR 실패: {type(e).__name__}") from e
