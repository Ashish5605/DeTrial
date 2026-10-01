@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or 24, then run this file again.
  pause
  exit /b 1
)
if not exist "node_modules\vite" (
  call npm ci
  if errorlevel 1 exit /b 1
)
echo DecisionTrail Classic opens at http://localhost:5176
call npm start
pause
