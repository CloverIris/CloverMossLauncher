@echo off
setlocal

if not exist "%~dp0apps\desktop\node_modules\electron\dist\electron.exe" goto missing_runtime
if not exist "%~dp0apps\desktop\out\main\index.js" goto missing_build
if not exist "%~dp0apps\desktop\out\main\backend.js" goto missing_build
if not exist "%~dp0apps\desktop\out\preload\index.js" goto missing_build
if not exist "%~dp0apps\desktop\out\renderer\index.html" goto missing_build

set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_RENDERER_URL="
start "" /D "%~dp0apps\desktop" "%~dp0apps\desktop\node_modules\electron\dist\electron.exe" "."
exit /b %errorlevel%

:missing_runtime
echo Electron runtime is missing. Run these commands from the repository root:
echo   corepack pnpm install --frozen-lockfile
echo   corepack pnpm --filter @clover/desktop exec electron --version
pause
exit /b 1

:missing_build
echo Desktop build is missing. Run this command from the repository root:
echo   corepack pnpm --filter @clover/desktop build
pause
exit /b 1
