/**
 * OCR 서비스 클라이언트.
 *
 * PaddleOCR은 Python 전용이라 별도 프로세스로 상주시킨다(ocr_service/main.py).
 * 여기서는 HTTP로만 이야기하고, 반환된 좌표는 lib/parsers/ocr.ts가 처리한다.
 *
 * **이미지는 이 경계를 넘지 않는다** — OCR 서비스는 로컬에 뜨고,
 * 대화 텍스트가 외부로 나가는 지점은 여기가 아니다(PRD §7).
 */

import type { OcrPage } from './ocr'

export const OCR_URL = process.env.OCR_SERVICE_URL ?? 'http://127.0.0.1:8756'

export class OcrServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'OcrServiceError'
  }
}

export type OcrHealth = {
  ok: boolean
  det: string
  rec: string
  load_sec: number | null
}

export async function health(signal?: AbortSignal): Promise<OcrHealth> {
  const res = await fetch(`${OCR_URL}/health`, { signal })
  if (!res.ok) throw new OcrServiceError(res.status, await res.text())
  return (await res.json()) as OcrHealth
}

/** 이미지 한 장 → 텍스트 줄 + 좌표 */
export async function recognize(
  image: Blob,
  filename = 'capture.png',
  signal?: AbortSignal,
): Promise<OcrPage & { elapsed_sec: number }> {
  const form = new FormData()
  form.append('file', image, filename)

  const res = await fetch(`${OCR_URL}/ocr`, {
    method: 'POST',
    body: form,
    signal,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new OcrServiceError(res.status, detail || res.statusText)
  }
  return (await res.json()) as OcrPage & { elapsed_sec: number }
}

/**
 * 여러 장을 순서대로 처리한다.
 *
 * 병렬로 던지지 않는다 — 모델이 하나뿐이라 동시 요청은 큐에서 기다릴 뿐이고,
 * 진행률을 장 단위로 보여주는 편이 처리 과정 화면(PRD §6)에 맞는다.
 */
export async function recognizeAll(
  images: Blob[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Array<OcrPage & { elapsed_sec: number }>> {
  const out: Array<OcrPage & { elapsed_sec: number }> = []
  for (let i = 0; i < images.length; i++) {
    out.push(await recognize(images[i], `capture-${i + 1}.png`, signal))
    onProgress?.(i + 1, images.length)
  }
  return out
}
