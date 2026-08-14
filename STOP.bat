@echo off
title NexusPort - Stopping...

echo.
echo  ==========================================
echo   NEXUSPORT - Stopping all servers
echo  ==========================================
echo.

:: Kill uvicorn (backend)
echo  Stopping backend (uvicorn)...
taskkill /F /IM uvicorn.exe >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq NexusPort BACKEND*" >nul 2>&1

:: Kill node / vite (frontend)
echo  Stopping frontend (vite / node)...
taskkill /F /FI "WINDOWTITLE eq NexusPort FRONTEND*" >nul 2>&1

:: Kill any leftover python running uvicorn on port 8000
echo  Releasing port 8000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000"') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: Kill any leftover node on port 5173
echo  Releasing port 5173...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173"') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo  All NexusPort servers stopped.
echo  ==========================================
echo.
pause
