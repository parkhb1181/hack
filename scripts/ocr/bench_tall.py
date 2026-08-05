"""긴 캡처 한도 측정 — .venv-paddle\\Scripts\\python.exe scripts/ocr/bench_tall.py

세로로 아주 긴 스크린샷(스크롤 캡처)을 넣어도 되는지 본다. 확인할 것 셋:
  1) OCR 서비스가 받아주는가 (MAX_BYTES)
  2) 시간이 선형으로 늘어나는가, 아니면 어느 지점에서 터지는가
  3) 검출 모델이 축소 리사이즈를 해서 **작은 글자를 놓치기 시작하는 지점**이 있는가

3번이 진짜 위험이다. PaddleOCR 검출은 긴 변을 제한 길이에 맞춰 줄인다.
이미지가 길수록 글자가 작아지고, 어느 순간부터 조용히 못 읽는다.
"""

import io
import json
import sys
import time
from pathlib import Path

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = [ROOT / "fixtures" / "real" / f"mom_0{i}.png" for i in (1, 2, 3)]
URL = "http://127.0.0.1:8756/ocr"


def stitch(times: int) -> Image.Image:
    """같은 캡처들을 세로로 이어붙여 긴 이미지를 만든다"""
    tiles = []
    for _ in range(times):
        for p in SRC:
            tiles.append(Image.open(p).convert("RGB"))
    w = max(t.width for t in tiles)
    h = sum(t.height for t in tiles)
    out = Image.new("RGB", (w, h), (0, 0, 0))
    y = 0
    for t in tiles:
        out.paste(t, (0, y))
        y += t.height
    return out


# 1배(3장) 기준 한글 줄 수를 재고, 길어질수록 얼마나 유지되는지 본다
def hangul_lines(lines) -> int:
    n = 0
    for l in lines:
        t = l.get("text", "")
        if any("가" <= c <= "힣" for c in t):
            n += 1
    return n


print(f"{'배수':>4} {'크기':>12} {'MB':>6} {'상태':>6} {'초':>7} {'줄':>5} {'한글줄':>6}  기대대비")
base_hangul = None

for mult in (1, 2, 4, 8, 16):
    im = stitch(mult)
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    data = buf.getvalue()
    mb = len(data) / 1024 / 1024

    t0 = time.time()
    try:
        r = requests.post(
            URL,
            files={"file": (f"tall_{mult}.png", data, "image/png")},
            timeout=900,
        )
    except Exception as e:  # noqa: BLE001
        print(f"{mult:>4}x {im.width}x{im.height:<6} {mb:6.1f} {'실패':>6}  {type(e).__name__}")
        break

    dt = time.time() - t0
    if r.status_code != 200:
        detail = r.text[:80].replace("\n", " ")
        print(f"{mult:>4}x {im.width}x{im.height:<6} {mb:6.1f} {r.status_code:>6} {dt:7.1f}   {detail}")
        break

    js = r.json()
    lines = js.get("lines", [])
    hg = hangul_lines(lines)
    if base_hangul is None:
        base_hangul = hg
    expected = base_hangul * mult
    ratio = hg / expected if expected else 0

    flag = "" if ratio >= 0.9 else ("  ⚠ 놓치기 시작" if ratio >= 0.5 else "  ✗ 대량 유실")
    print(
        f"{mult:>4}x {im.width}x{im.height:<6} {mb:6.1f} {r.status_code:>6} {dt:7.1f} "
        f"{len(lines):>5} {hg:>6}  {ratio*100:5.1f}%{flag}"
    )

    sys.stdout.flush()
