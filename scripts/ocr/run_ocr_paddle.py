"""PaddleOCR 실행 (한국어) — 이미지 → {width, height, lines[{text, box, confidence}]}

사용: .venv-paddle\\Scripts\\python.exe scripts/ocr/run_ocr_paddle.py <이미지...>
출력: 같은 이름의 .ocr.json  (다른 러너와 동일 포맷)

PaddleOCR 2.x / 3.x 어느 쪽이 깔려도 동작하도록 호출부를 분기한다.
"""

import json
import os
import sys
import time
from pathlib import Path

# oneDNN 커널이 이 빌드에서 PIR 속성 변환에 실패한다
# (ConvertPirAttribute2RuntimeAttribute not support). 끄고 순수 CPU로 돌린다.
os.environ.setdefault("FLAGS_use_mkldnn", "0")

from PIL import Image
from paddleocr import PaddleOCR

# 검출 모델. 실측(scripts/ocr/bench_ocr_speed.py):
#   server_det  PC 18.8초 / 모바일 73.8초
#   mobile_det  PC 10.8초 / 모바일 17.9초   ← 최대 4.1배
# 해상도 제한(text_det_limit_side_len)은 오히려 느려져 쓰지 않는다.
DET_MODEL = os.environ.get("OCR_DET_MODEL", "PP-OCRv5_mobile_det")

# ⚠️ 검출 모델을 명시하면 PaddleOCR이 lang 기반 기본값 적용을 멈추고 인식 모델을
# 중국어 기본값으로 되돌린다. 실측: 한글이 전부 빈 문자열로 나왔다.
# 인식 모델도 반드시 함께 못 박는다.
REC_MODEL = os.environ.get("OCR_REC_MODEL", "korean_PP-OCRv5_mobile_rec")

try:  # 3.x
    engine = PaddleOCR(
        lang="korean",
        text_detection_model_name=DET_MODEL,
        text_recognition_model_name=REC_MODEL,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        enable_mkldnn=False,
    )
    API = 3
except TypeError:  # 2.x
    engine = PaddleOCR(lang="korean", use_angle_cls=False, show_log=False,
                       enable_mkldnn=False)
    API = 2


def extract(path: str):
    """(poly, text, score) 리스트로 정규화한다."""
    if API == 3:
        res = engine.predict(path)
        out = []
        for page in res:
            d = page.json["res"] if hasattr(page, "json") else page
            polys = d.get("rec_polys") or d.get("dt_polys") or []
            texts = d.get("rec_texts") or []
            scores = d.get("rec_scores") or []
            for poly, text, score in zip(polys, texts, scores):
                out.append((poly, text, score))
        return out

    res = engine.ocr(path, cls=False)
    out = []
    for page in res or []:
        for poly, (text, score) in page or []:
            out.append((poly, text, score))
    return out


def run(path: Path) -> dict:
    with Image.open(path) as im:
        width, height = im.size

    started = time.time()
    items = extract(str(path))
    elapsed = time.time() - started

    lines = []
    for poly, text, score in items:
        xs = [float(p[0]) for p in poly]
        ys = [float(p[1]) for p in poly]
        lines.append(
            {
                "text": text,
                "box": [round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))],
                "confidence": round(float(score), 4),
            }
        )

    lines.sort(key=lambda l: (l["box"][1], l["box"][0]))
    return {"width": width, "height": height, "lines": lines,
            "elapsed_sec": round(elapsed, 3)}


for arg in sys.argv[1:]:
    p = Path(arg)
    out = run(p)
    p.with_suffix(".ocr.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"{p.name}: {len(out['lines'])}줄 · {out['elapsed_sec']}초 · {out['width']}x{out['height']}")
