@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js LTS from https://nodejs.org/ then try again.
  pause
  exit /b 1
)
node scripts/start-online.mjs
pause
