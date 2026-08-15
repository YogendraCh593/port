@echo off
title NexusPort - Control Center
color 0B

:MENU
cls
echo.
echo  ============================================================
echo   NEXUSPORT  ^|  Intelligent Maritime Operations
echo   Dynamic Hybrid QAOA Port Optimization System
echo  ============================================================
echo.
echo   Select an option:
echo.
echo   [1]  START        -  Start backend + frontend + open browser
echo   [2]  STOP         -  Stop all servers (free ports 8000 + 5173)
echo   [3]  INSTALL      -  First-time install of all dependencies
echo   [4]  BACKEND ONLY -  Start only the Python backend (port 8000)
echo   [5]  FRONTEND ONLY-  Start only the React frontend (port 5173)
echo   [6]  TEST         -  Run all 7 optimizer acceptance tests
echo   [7]  RESTART      -  Stop everything then start fresh
echo   [8]  STATUS       -  Check if servers are running
echo   [0]  EXIT         -  Close this menu
echo.
echo  ============================================================
echo.
set /p CHOICE=  Enter option: 

if "%CHOICE%"=="1" goto START
if "%CHOICE%"=="2" goto STOP
if "%CHOICE%"=="3" goto INSTALL
if "%CHOICE%"=="4" goto BACKEND
if "%CHOICE%"=="5" goto FRONTEND
if "%CHOICE%"=="6" goto TEST
if "%CHOICE%"=="7" goto RESTART
if "%CHOICE%"=="8" goto STATUS
if "%CHOICE%"=="0" goto EXIT
echo  Invalid option. Try again.
timeout /t 2 /nobreak >nul
goto MENU


:: ============================================================
:START
:: ============================================================
cls
echo.
echo  ============================================================
echo   NEXUSPORT  ^|  Starting all servers...
echo  ============================================================
echo.

echo  [1/3]  Starting Python backend on port 8000...
start "NEXUS-BACKEND" /D "%~dp0backend" /MIN cmd /k ^
  "color 0B && echo. && echo  NEXUSPORT BACKEND ^| http://localhost:8000 && echo  Docs: http://localhost:8000/docs && echo. && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"
echo         Waiting 7 seconds for backend to boot...
timeout /t 7 /nobreak >nul

echo  [2/3]  Starting React frontend on port 5173...
start "NEXUS-FRONTEND" /D "%~dp0" /MIN cmd /k ^
  "color 0E && echo. && echo  NEXUSPORT FRONTEND ^| http://localhost:5173 && echo. && npm run dev"
echo         Waiting 8 seconds for frontend to boot...
timeout /t 8 /nobreak >nul

echo  [3/3]  Opening browser...
start "" "http://localhost:5173"

echo.
echo  ============================================================
echo   RUNNING!
echo.
echo   App      ->  http://localhost:5173
echo   API      ->  http://localhost:8000
echo   API Docs ->  http://localhost:8000/docs
echo.
echo   Two minimised windows in taskbar:
echo     NEXUS-BACKEND    (Python / uvicorn)
echo     NEXUS-FRONTEND   (Node / Vite)
echo.
echo   Press any key to return to menu.
echo  ============================================================
echo.
pause >nul
goto MENU


:: ============================================================
:STOP
:: ============================================================
cls
echo.
echo  ============================================================
echo   NEXUSPORT  ^|  Stopping all servers...
echo  ============================================================
echo.

echo  Closing NEXUS-BACKEND window...
taskkill /F /FI "WINDOWTITLE eq NEXUS-BACKEND*" >nul 2>&1

echo  Closing NEXUS-FRONTEND window...
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
echo.
echo  Press any key to return to menu.
pause >nul
goto MENU


:: ============================================================
:INSTALL
:: ============================================================
cls
echo.
echo  ============================================================
echo   NEXUSPORT  ^|  Installing all dependencies
echo  ============================================================
echo.

echo  [1/2]  Installing Python backend dependencies...
cd /d "%~dp0backend"
pip install -r requirements.txt --only-binary=:all: --quiet
if %errorlevel% neq 0 (
    echo  Retrying without --only-binary flag...
    pip install -r requirements.txt --quiet
)
echo         Backend deps done.

echo  [2/2]  Installing React frontend dependencies...
cd /d "%~dp0"
call npm install --legacy-peer-deps --prefer-offline 2>nul
if %errorlevel% neq 0 (
    call npm install 2>nul
)
echo         Frontend deps done.

echo.
echo  Installation complete!
echo  Press any key to return to menu.
pause >nul
goto MENU


:: ============================================================
:BACKEND
:: ============================================================
cls
echo.
echo  ============================================================
echo   NEXUSPORT  ^|  Backend only (port 8000)
echo  ============================================================
echo.
echo   Endpoints available once started:
echo     http://localhost:8000/health
echo     http://localhost:8000/docs
echo     http://localhost:8000/optimization/run
echo     http://localhost:8000/optimization/compare-algorithms
echo     http://localhost:8000/optimization/live-state
echo     http://localhost:8000/optimization/config
echo.
echo  Starting backend (this window will show logs)...
echo  Press Ctrl+C to stop. Then press any key to return to menu.
echo.
cd /d "%~dp0backend"
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
pause >nul
goto MENU


:: ============================================================
:FRONTEND
:: ============================================================
cls
echo.
echo  ============================================================
echo   NEXUSPORT  ^|  Frontend only (port 5173)
echo  ============================================================
echo.
echo  NOTE: Make sure backend is running on port 8000 first.
echo  Use option [4] BACKEND ONLY in a separate terminal.
echo.
echo  Press Ctrl+C to stop. Then press any key to return to menu.
echo.
cd /d "%~dp0"
npm run dev
pause >nul
goto MENU


:: ============================================================
:TEST
:: ============================================================
cls
echo.
echo  ============================================================
echo   NEXUSPORT  ^|  Running optimizer acceptance tests
echo  ============================================================
echo.
cd /d "%~dp0backend"
python _test_optimizer.py
echo.
echo  Press any key to return to menu.
pause >nul
goto MENU


:: ============================================================
:RESTART
:: ============================================================
cls
echo.
echo  Stopping all servers first...
taskkill /F /FI "WINDOWTITLE eq NEXUS-BACKEND*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq NEXUS-FRONTEND*" >nul 2>&1
for /f "tokens=5" %%P in ('netstat -aon 2^>nul ^| findstr /R ":8000 "') do taskkill /F /PID %%P >nul 2>&1
for /f "tokens=5" %%P in ('netstat -aon 2^>nul ^| findstr /R ":5173 "') do taskkill /F /PID %%P >nul 2>&1
echo  Servers stopped. Starting fresh in 3 seconds...
timeout /t 3 /nobreak >nul
goto START


:: ============================================================
:STATUS
:: ============================================================
cls
echo.
echo  ============================================================
echo   NEXUSPORT  ^|  Server Status Check
echo  ============================================================
echo.

echo  Checking port 8000 (backend)...
netstat -aon 2>nul | findstr /R ":8000 " >nul 2>&1
if %errorlevel%==0 (
    echo   [RUNNING]  Backend is UP on port 8000
    echo              http://localhost:8000/health
) else (
    echo   [STOPPED]  Backend is NOT running
)

echo.
echo  Checking port 5173 (frontend)...
netstat -aon 2>nul | findstr /R ":5173 " >nul 2>&1
if %errorlevel%==0 (
    echo   [RUNNING]  Frontend is UP on port 5173
    echo              http://localhost:5173
) else (
    echo   [STOPPED]  Frontend is NOT running
)

echo.
echo  ============================================================
echo  Press any key to return to menu.
pause >nul
goto MENU


:: ============================================================
:EXIT
:: ============================================================
cls
echo.
echo  Closing NexusPort Control Center. Goodbye.
echo.
timeout /t 2 /nobreak >nul
exit
