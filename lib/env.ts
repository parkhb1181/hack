/**
 * `.env.local` 로더 (서버 전용).
 *
 * ⚠️ **덮어쓴다.** 셸에 남아 있던 옛 키가 조용히 이기는 상황을 막기 위해서다 —
 * 실측으로 두 번 당했다. 스크립트에서 한 번, 그리고 앱에서 또 한 번.
 *
 * Next.js도 `.env.local`을 읽지만 **프로세스 환경을 우선한다.** 셸에 다른
 * `GEMINI_API_KEY`가 남아 있으면 `.env.local`의 새 키가 무시되고, 원인을 알 수
 * 없는 403 PERMISSION_DENIED가 반복된다. 같은 스크립트가 셸에서는 되고 앱에서만
 * 안 되는 형태로 나타나서 특히 헷갈린다. **서버 라우트에서도 불러야 한다.**
 */

import { existsSync, readFileSync } from 'node:fs'

const LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/

export function loadEnvLocal(path = '.env.local'): string[] {
  if (!existsSync(path)) return []

  // PowerShell의 -Encoding UTF8은 BOM을 붙인다
  const raw = readFileSync(path, 'utf8').replace(/^﻿/, '')
  const loaded: string[] = []

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const m = LINE.exec(line)
    if (!m) continue
    const value = m[2].trim().replace(/^(['"])(.*)\1$/, '$2')
    process.env[m[1]] = value
    loaded.push(m[1])
  }
  return loaded
}
