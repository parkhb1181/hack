"""모델 로드 비용 측정 — 프로세스를 매번 띄우는 게 얼마나 비싼가.

.venv-paddle\\Scripts\\python.exe scripts/ocr/bench_load.py
"""

import os
import time

os.environ.setdefault("FLAGS_use_mkldnn", "0")

t0 = time.time()
from paddleocr import PaddleOCR

import_sec = time.time() - t0

t0 = time.time()
engine = PaddleOCR(
    lang="korean",
    text_detection_model_name="PP-OCRv5_mobile_det",
    text_recognition_model_name="korean_PP-OCRv5_mobile_rec",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
    enable_mkldnn=False,
)
build_sec = time.time() - t0

IMG = "fixtures/real/pc_dark_01.png"

t0 = time.time()
list(engine.predict(IMG))
first_sec = time.time() - t0

warm = []
for _ in range(3):
    t0 = time.time()
    list(engine.predict(IMG))
    warm.append(time.time() - t0)

print(f"\nimport paddleocr   {import_sec:6.2f}초")
print(f"PaddleOCR() 생성   {build_sec:6.2f}초")
print(f"첫 추론 (초기화)   {first_sec:6.2f}초")
print(f"이후 추론 평균     {sum(warm) / len(warm):6.2f}초   {[round(w, 2) for w in warm]}")
print(f"\n프로세스 1회 비용  {import_sec + build_sec + first_sec:6.2f}초")
print(f"상주 시 요청당     {sum(warm) / len(warm):6.2f}초")
