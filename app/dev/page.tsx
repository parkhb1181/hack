import Analyzer from '@/app/_components/Analyzer'

/** 개발자 모드 — 코랄이 아니라 모노다. 좌표·JSON·프롬프트를 읽는 화면이라서. */
export default function Page() {
  return (
    <div className="dev-root">
      <Analyzer devDefault />
    </div>
  )
}
