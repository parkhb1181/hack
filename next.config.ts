import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // 원문 미보관 원칙(PRD §7.2): 서버는 무상태로 둔다.
  // 캐시는 IndexedDB(클라이언트)만 사용하므로 서버 캐시 설정을 켜지 않는다.
  experimental: {},
}

export default nextConfig
