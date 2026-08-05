"""OCR 속도 실험 — .venv-paddle\\Scripts\\python.exe scripts/ocr/bench_ocr_speed.py

검출 모델(server/mobile)과 검출 입력 한계 변을 바꿔가며 속도와 인식 줄 수를 잰다.
줄 수가 크게 줄면 정확도를 잃은 것이므로 속도만 보고 고르면 안 된다.
"""

import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("FLAGS_use_mkldnn", "0")

from paddleocr import PaddleOCR

IMAGES = [
    Path("fixtures/real/pc_dark_01.png"),
    Path("fixtures/real/mobile_dark_sticker.png"),
]

VARIANTS = [
    ("server / 기본", {}),
    ("server / 960", {"text_det_limit_side_len": 960}),
    ("mobile / 기본", {"text_detection_model_name": "PP-OCRv5_mobile_det"}),
    ("mobile / 960", {"text_detection_model_name": "PP-OCRv5_mobile_det",
                      "text_det_limit_side_len": 960}),
    ("mobile / 736", {"text_detection_model_name": "PP-OCRv5_mobile_det",
                      "text_det_limit_side_len": 736}),
]

BASE = dict(
    lang="korean",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
    enable_mkldnn=False,
)


def texts_of(engine, path: str) -> list[str]:
    out: list[str] = []
    for page in engine.predict(path):
        d = page.json["res"] if hasattr(page, "json") else page
        out.extend(d.get("rec_texts") or [])
    return out


print(f"{'변형':<16} {'이미지':<24} {'초':>7} {'줄':>5}")
print("-" * 58)

results: dict[str, dict[str, object]] = {}
for label, extra in VARIANTS:
    try:
        engine = PaddleOCR(**BASE, **extra)
    except Exception as e:  # 모델이 없거나 인자가 안 먹으면 건너뛴다
        print(f"{label:<16} 생성 실패: {type(e).__name__}")
        continue

    for img in IMAGES:
        if not img.exists():
            continue
        texts_of(engine, str(img))  # 워밍업 (모델 로드 제외)
        started = time.time()
        texts = texts_of(engine, str(img))
        elapsed = time.time() - started
        print(f"{label:<16} {img.name:<24} {elapsed:>7.2f} {len(texts):>5}")
        results.setdefault(label, {})[img.name] = {
            "sec": round(elapsed, 2),
            "lines": len(texts),
            "texts": texts,
        }

Path("fixtures/real/speed.json").write_text(
    json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
)
print("\nfixtures/real/speed.json 에 전체 결과 저장")
