@echo off
rem hackathon/ (별개 저장소 ssggii/hackathon)의 FastAPI 웹 화면을 띄운다.
rem
rem ⚠️ `set GEMINI_API_KEY=` 한 줄이 핵심이다.
rem 시스템 환경변수에 낡은 키가 박혀 있는데, 저쪽 _load_dotenv가
rem os.environ.setdefault를 쓰므로 .env가 그걸 못 덮는다 → LLM 단계에서 403.
rem `uv run --env-file`도 기존 값을 안 덮는다(실측). 비워야 .env 키가 올라온다.
rem
rem 근본 해결은 시스템 환경변수에서 낡은 키를 지우는 것이다.

set GEMINI_API_KEY=
cd /d "%~dp0..\..\hackathon"
uv run uvicorn web.app:app --port 8000
