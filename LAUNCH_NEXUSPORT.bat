@echo off
title NEXUSPORT LAUNCHER
color 0A

echo.
echo  ############################################
echo  #                                          #
echo  #     NEXUSPORT  -  MARITIME OPS CENTER    #
echo  #                                          #
echo  ############################################
echo.
echo  Launching servers, please wait...
echo.

:: ── Start Backend ─────────────────────────────
echo  [STEP 1] Starting Python backend on port 8000...
start "NEXUSPORT-BACKEND" /D "%~dp0backend" /MIN cmd /k "color 0B && echo. && echo  NEXUSPORT BACKEND SERVER && echo  http://localhost:8000 && echo  http://localhost:8000/docs && echo. && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

echo  Backend window opened. Waiting 6 seconds to boot...
timeout /t 6 /nobreak >nul

:: ── Start Frontend ────────────────────────────
echo  [STEP 2] Starting React frontend on port 5173...
start "NEXUSPORT-FRONTEND" /D "%~dp0" /MIN cmd /k "color 0E && echo. && echo  NEXUSPORT FRONTEND SERVER && echo  http://localhost:5173 && echo. && npm run dev"

echo  Frontend window opened. Waiting 7 seconds to boot...
timeout /t 7 /nobreak >nul

:: ── Open Browser ──────────────────────────────
echo  [STEP 3] Opening browser...
start "" "http://localhost:5173"

echo.
echo  ############################################
echo.
echo   APP IS RUNNING!
echo.
echo   Open in browser  : http://localhost:5173
echo   Backend API      : http://localhost:8000
echo   API Docs         : http://localhost:8000/docs
echo.
echo   Two minimised windows are running:
echo     - NEXUSPORT-BACKEND
echo     - NEXUSPORT-FRONTEND
echo.
echo   Run SHUTDOWN_NEXUSPORT.bat to stop everything.
echo.
echo  ############################################
echo.
pause
