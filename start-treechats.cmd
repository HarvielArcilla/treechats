@echo off
rem Double-click to start Treechats on Windows. It sets up what's missing the first time.
rem Close this window to stop Treechats.
setlocal
rem Run from a copy, so updating this file with git pull can't disturb the window that's running it.
if /i not "%~1"=="--run" (
  copy /y "%~f0" "%TEMP%\treechats-start.cmd" >nul
  call "%TEMP%\treechats-start.cmd" --run "%~dp0."
  exit /b
)
cd /d "%~2"
title Treechats

where node >nul 2>nul
if errorlevel 1 call :install_node
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js still isn't available. Install the LTS version from https://nodejs.org,
  echo   then double-click start-treechats again.
  echo.
  pause
  exit /b 1
)

call :update
echo.
echo   Getting Treechats ready...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  pause
  exit /b 1
)
if not exist .env copy .env.example .env >nul

call :check_replies

call npm start
pause
exit /b 0

:update
rem Get the latest version from GitHub, if git is installed and nothing here was changed by hand.
if not exist .git exit /b 0
where git >nul 2>nul
if errorlevel 1 exit /b 0
echo.
echo   Checking for updates...
git pull --ff-only --quiet
if errorlevel 1 echo   Couldn't update: you may be offline, or files here were changed. Starting the version you have.
exit /b 0

:install_node
echo.
echo   Treechats needs Node.js, which isn't installed yet.
where winget >nul 2>nul
if errorlevel 1 (
  echo   Install the LTS version from https://nodejs.org, then double-click start-treechats again.
  exit /b 0
)
choice /c YN /m "  Install Node.js LTS now"
if errorlevel 2 exit /b 0
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
rem winget doesn't update this window's PATH, so add the usual install folder ourselves
set "PATH=%ProgramFiles%\nodejs;%PATH%"
exit /b 0

:check_replies
rem An API key in .env is enough on its own.
findstr /r /c:"^ANTHROPIC_API_KEY=..*" .env >nul 2>nul
if not errorlevel 1 exit /b 0
set "PATH=%PATH%;%USERPROFILE%\.local\bin"
where claude >nul 2>nul
if errorlevel 1 call :install_claude
where claude >nul 2>nul
if errorlevel 1 exit /b 0
claude auth status >nul 2>nul
if not errorlevel 1 exit /b 0
echo.
echo   Sign in to Claude Code with your Claude account so Treechats can use your subscription.
echo   A browser window will open.
claude auth login
exit /b 0

:install_claude
echo.
echo   For replies, Treechats needs either an API key in the .env file, or Claude Code
echo   signed in with your Claude account (Pro or Max), which uses your subscription.
choice /c YN /m "  Install Claude Code now"
if errorlevel 2 (
  echo   OK. Add ANTHROPIC_API_KEY to .env any time, then restart Treechats.
  exit /b 0
)
curl -fsSL https://claude.ai/install.cmd -o "%TEMP%\claude-install.cmd"
if errorlevel 1 exit /b 0
call "%TEMP%\claude-install.cmd"
del "%TEMP%\claude-install.cmd" >nul 2>nul
exit /b 0
