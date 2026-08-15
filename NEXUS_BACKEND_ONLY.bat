@echo off
title NexusPort Backend
color 0B

echo.
echo  =====================================================
echo   NEXUSPORT  ^|  Backend only (port 8000)
echo  =====================================================
echo.
echo  Endpoints:
echo    http://localhost:8000/health
echo    http://localhost:8000/docs
echo    http://localhost:8000/optimization/run
echo    http://localhost:8000/optimization/compare-algorithms
echo    http://localhost:8000/optimization/live-state
echo    http://localhost:8000/optimization/event-log
echo    http://localhost:8000/optimization/config
echo.

cd /d "%~dp0backend"
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
