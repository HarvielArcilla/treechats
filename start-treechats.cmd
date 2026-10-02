@echo off
rem Double-click to start Treechats on Windows. Close this window to stop it.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Treechats needs Node.js. Install the LTS version from https://nodejs.org, then try again.
  echo.
  pause
  exit /b 1
)
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  pause
  exit /b 1
)
call npm start
pause
