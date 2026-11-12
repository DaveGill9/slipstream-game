@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js LTS from https://nodejs.org/ then try again.
  pause
  exit /b 1
)
if exist "server-dist\server.mjs" if exist "dist\index.html" goto run
if not exist "package.json" (
  echo Game files are missing. Extract the whole Slipstream folder and try again.
  pause
  exit /b 1
)
echo First run: building the game. This takes a minute...
if not exist "node_modules" (
  call npm ci
  if errorlevel 1 goto buildfail
)
call npm run build
if errorlevel 1 goto buildfail
:run
node scripts/start-online.mjs
pause
exit /b 0
:buildfail
echo Build failed. Check the messages above.
pause
exit /b 1
