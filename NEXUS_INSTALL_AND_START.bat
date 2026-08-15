@echo off
title NexusPort - Install + Start
color 0B

echo.
echo  =====================================================
echo   NEXUSPORT  ^|  First-time setup + launch
echo  =====================================================
echo.

:: ── Backend deps ──────────────────────────────────────────────────────────
echo  [1/4]  Installing backend dependencies...
cd /d "%~dp0backend"
pip install -r requirements.txt --only-binary=:all: --quiet
if %errorlevel% neq 0 (
    echo  ERROR: pip install failed. Trying without --only-binary...
    pip install -r requirements.txt --quiet
)
echo         Done.

:: ── Frontend deps ─────────────────────────────────────────────────────────
echo  [2/4]  Installing frontend dependencies...
cd /d "%~dp0"
call npm install --legacy-peer-deps --prefer-offline 2>nul
if %errorlevel% neq 0 (
    echo  Trying npm install without flags...
    call npm install 2>nul
)
echo         Done.

:: ── Backend ───────────────────────────────────────────────────────────────
echo  [3/4]  Starting Python backend on port 8000...
start "NEXUS-BACKEND" /D "%~dp0backend" /MIN cmd /k ^
  "color 0B && echo. && echo  NEXUSPORT BACKEND && echo  App  : http://localhost:8000 && echo  Docs : http://localhost:8000/docs && echo. && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

echo         Waiting 7 seconds...
timeout /t 7 /nobreak >nul

:: ── Frontend ──────────────────────────────────────────────────────────────
echo  [4/4]  Starting React frontend on port 5173...
start "NEXUS-FRONTEND" /D "%~dp0" /MIN cmd /k ^
  "color 0E && echo. && echo  NEXUSPORT FRONTEND && echo  App  : http://localhost:5173 && echo. && npm run dev"

timeout /t 8 /nobreak >nul
start "" "http://localhost:5173"

echo.
echo  =====================================================
echo   RUNNING!
echo   App      ->  http://localhost:5173
echo   API Docs ->  http://localhost:8000/docs
echo  =====================================================
echo.
pause
