@echo off
echo ===================================
echo   MedGuard AI - System Startup
echo ===================================
echo.
echo [1/2] Killing old server processes...
taskkill /F /IM node.exe >nul 2>&1

echo [2/2] Starting Unified MedGuard Server (Port 8081)...
start "MedGuard Server" /MIN npm start

echo.
echo All Systems Operational!
echo Opening Dashboard...
timeout /t 3 >nul
start "" "http://localhost:8081/monitor.html"

echo.
echo ===================================
echo   Do NOT close this window.
echo   Minimize it to keep running.
echo ===================================
pause
