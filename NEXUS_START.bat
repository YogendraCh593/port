@echo off
title NexusPort - Starting
color 0A

echo.
echo  =====================================================
echo   NEXUSPORT  ^|  Dynamic Hybrid Maritime Operations
echo  =====================================================
echo.

:: ── Backend ──────────────────────────────────────────────────────────────
echo  [1/3]  Starting Python backend on port 8000...
start "NEXUS-BACKEND" /D "%~dp0backend" /MIN cmd /k ^
  "color 0B && echo. && echo  NEXUSPORT BACKEND && echo  App  : http://localhost:8000 && echo  Docs : http://localhost:8000/docs && echo. && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

echo         Waiting 7 seconds for backend to boot...
timeout /t 7 /nobreak >nul

:: ── Frontend ─────────────────────────────────────────────────────────────
echo  [2/3]  Starting React frontend on port 5173...
start "NEXUS-FRONTEND" /D "%~dp0" /MIN cmd /k ^
  "color 0E && echo. && echo  NEXUSPORT FRONTEND && echo  App  : http://localhost:5173 && echo. && npm run dev"

echo         Waiting 8 seconds for frontend to boot...
timeout /t 8 /nobreak >nul

:: ── Browser ───────────────────────────────────────────────────────────────
echo  [3/3]  Opening browser...
start "" "http://localhost:5173"

echo.
echo  =====================================================
echo   RUNNING!
echo.
echo   App      ->  http://localhost:5173
echo   API      ->  http://localhost:8000
echo   API Docs ->  http://localhost:8000/docs
echo.
echo   Minimised windows in taskbar:
echo     NEXUS-BACKEND   (Python/uvicorn)
echo     NEXUS-FRONTEND  (Node/Vite)
echo.
echo   Run NEXUS_STOP.bat to stop everything.
echo  =====================================================
echo.
pause
