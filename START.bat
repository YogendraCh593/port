@echo off
title NexusPort Launcher

echo.
echo  ==========================================
echo   NEXUSPORT - Intelligent Maritime Ops
echo  ==========================================
echo.
echo  Starting backend and frontend...
echo  Please wait - do not close this window.
echo.

:: Start backend in a new visible window
start "NexusPort BACKEND :8000" /D "%~dp0backend" cmd /k "echo NEXUSPORT BACKEND && echo. && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

echo  [1/2] Backend window opened - waiting 5 seconds for it to boot...
timeout /t 5 /nobreak

:: Start frontend in a new visible window  
start "NexusPort FRONTEND :5173" /D "%~dp0" cmd /k "echo NEXUSPORT FRONTEND && echo. && npm run dev"

echo  [2/2] Frontend window opened - waiting 6 seconds for it to boot...
timeout /t 6 /nobreak

:: Open browser
echo  Opening browser at http://localhost:5173
start http://localhost:5173

echo.
echo  ==========================================
echo   NexusPort is RUNNING
echo.
echo   App      -^>  http://localhost:5173
echo   API      -^>  http://localhost:8000
echo   API Docs -^>  http://localhost:8000/docs
echo.
echo   Two windows are open:
echo     "NexusPort BACKEND :8000"
echo     "NexusPort FRONTEND :5173"
echo.
echo   To STOP: close those two windows
echo   or run STOP.bat
echo  ==========================================
echo.
pause
