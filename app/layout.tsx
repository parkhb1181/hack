import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '기울기',
  description: '대화가 어느 쪽으로 기울어 있는지 하나의 숫자로 본다',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
