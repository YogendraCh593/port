@echo off
title NexusPort - Stopping...
color 0C

echo.
echo  ============================================
echo   NEXUSPORT  ^|  Shutting down all servers
echo  ============================================
echo.

echo  Closing NEXUS-BACKEND window...
taskkill /F /FI "WINDOWTITLE eq NEXUS-BACKEND*" >nul 2>&1

echo  Closing NEXUS-FRONTEND window...
taskkill /F /FI "WINDOWTITLE eq NEXUS-FRONTEND*" >nul 2>&1

echo  Killing any process on port 8000...
for /f "tokens=5" %%P in ('netstat -aon 2^>nul ^| findstr ":8000 "') do (
    taskkill /F /PID %%P >nul 2>&1
)

echo  Killing any process on port 5173...
for /f "tokens=5" %%P in ('netstat -aon 2^>nul ^| findstr ":5173 "') do (
    taskkill /F /PID %%P >nul 2>&1
)

echo.
echo  All NexusPort servers stopped.
echo  Run NEXUS_START.bat to start again.
echo  ============================================
echo.
pause
