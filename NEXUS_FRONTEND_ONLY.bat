@echo off
title NexusPort Frontend
color 0E

echo.
echo  =====================================================
echo   NEXUSPORT  ^|  Frontend only (port 5173)
echo  =====================================================
echo.
echo  Make sure the backend is running on port 8000 first.
echo  Run NEXUS_BACKEND_ONLY.bat in a separate window.
echo.

cd /d "%~dp0"
npm run dev
