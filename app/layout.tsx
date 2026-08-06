import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '썸',
  description: '우리 대화, 어느 쪽으로 기울어 있을까요?',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/*
          Pretendard. CDN이 죽어도 시스템 폰트로 떨어지게 globals.css에
          fallback을 깔아 뒀다 — 데모 중에 글꼴 하나 때문에 멈추면 안 된다.
        */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
