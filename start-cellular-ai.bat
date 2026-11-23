@echo off
title MedGuard AI Receptionist + OpenLine Gateway
echo =====================================================================
echo Starting MedGuard AI Receptionist with Nothing Phone Cellular Gateway
echo =====================================================================

echo [1/3] Connecting ADB to Nothing Phone over Wi-Fi Hotspot...
adb connect 10.58.246.212:5555

echo [2/3] Starting OpenLine Server (Port 8989)...
start "OpenLine Gateway Server" cmd /k "cd /d %~dp0openline\server && node --env-file=.env dist/index.js"

timeout /t 3 /nobreak >nul

echo [3/3] Starting MedGuard AI Receptionist (Port 3000)...
start "MedGuard AI Receptionist" cmd /k "cd /d %~dp0ai-receptionist && node server.js"

echo.
echo =====================================================================
echo All services launched!
echo OpenLine Console:    http://localhost:8989/
echo MedGuard Dashboard:  http://localhost:3000/
echo =====================================================================
pause
