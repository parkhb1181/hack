/**
 * 브랜드 마크.
 *
 * 예전에는 `↗` 글리프를 그대로 썼는데, **글자라서 폰트에 휘둘렸다** — 굵기가
 * 시스템마다 달라지고, 껍데기의 −8도 회전과 화살표 각도가 겹쳐 방향이 애매해졌다.
 *
 * 도형 두 개로 간다. 크기가 다른 두 원이 높이를 어긋나게 놓여 있는 형태 —
 * **둘이 있는데 같지 않다.** 이 앱이 재는 게 정확히 그거다.
 * 획이 없으니 16px 파비콘까지 그대로 버틴다.
 */
export default function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <circle cx="16" cy="26" r="12" fill="currentColor" />
      <circle cx="32" cy="15" r="7.5" fill="currentColor" opacity="0.62" />
    </svg>
  )
}
