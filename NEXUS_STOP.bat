@echo off
title NexusPort - Stopping
color 0C

echo.
echo  =====================================================
echo   NEXUSPORT  ^|  Shutting down all servers
echo  =====================================================
echo.

echo  Closing backend window...
taskkill /F /FI "WINDOWTITLE eq NEXUS-BACKEND*" >nul 2>&1

echo  Closing frontend window...
taskkill /F /FI "WINDOWTITLE eq NEXUS-FRONTEND*" >nul 2>&1

echo  Releasing port 8000 (backend)...
for /f "tokens=5" %%P in ('netstat -aon 2^>nul ^| findstr /R ":8000 "') do (
    taskkill /F /PID %%P >nul 2>&1
)

echo  Releasing port 5173 (frontend)...
for /f "tokens=5" %%P in ('netstat -aon 2^>nul ^| findstr /R ":5173 "') do (
    taskkill /F /PID %%P >nul 2>&1
)

echo.
echo  All servers stopped.
echo  Run NEXUS_START.bat to start again.
echo  =====================================================
echo.
pause
