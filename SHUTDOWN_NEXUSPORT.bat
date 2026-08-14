@echo off
title NEXUSPORT SHUTDOWN
color 0C

echo.
echo  ############################################
echo  #                                          #
echo  #     NEXUSPORT  -  SHUTTING DOWN          #
echo  #                                          #
echo  ############################################
echo.

:: ── Close named server windows ────────────────
echo  [1/4] Closing backend server window...
taskkill /F /FI "WINDOWTITLE eq NEXUSPORT-BACKEND*" >nul 2>&1
echo        Done.

echo  [2/4] Closing frontend server window...
taskkill /F /FI "WINDOWTITLE eq NEXUSPORT-FRONTEND*" >nul 2>&1
echo        Done.

:: ── Kill by port (fallback) ───────────────────
echo  [3/4] Releasing port 8000 (backend)...
for /f "tokens=5" %%P in ('netstat -aon ^| findstr /R ":8000 "') do (
    taskkill /F /PID %%P >nul 2>&1
)
echo        Done.

echo  [4/4] Releasing port 5173 (frontend)...
for /f "tokens=5" %%P in ('netstat -aon ^| findstr /R ":5173 "') do (
    taskkill /F /PID %%P >nul 2>&1
)
echo        Done.

echo.
echo  ############################################
echo.
echo   All NexusPort servers have been stopped.
echo   Run LAUNCH_NEXUSPORT.bat to start again.
echo.
echo  ############################################
echo.
pause
