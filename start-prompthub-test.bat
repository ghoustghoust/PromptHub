@echo off
setlocal EnableExtensions
title PromptHub - Native Test Launcher
cd /d "%~dp0"

echo.
echo [PromptHub] Pre-package native test launcher
echo [PromptHub] This rebuilds and opens the current Electron workspace.
echo [PromptHub] It uses isolated test data and does not modify the formal profile.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 24 or later is required but was not found in PATH.
  goto :failed
)

node -e "const major=Number(process.versions.node.split('.')[0]);process.exit(major>=24?0:1)"
if errorlevel 1 (
  echo [ERROR] Node.js 24 or later is required.
  node --version
  goto :failed
)

set "PNPM_CMD="
where pnpm.cmd >nul 2>nul
if not errorlevel 1 set "PNPM_CMD="pnpm.cmd""
if not defined PNPM_CMD (
  where pnpm.exe >nul 2>nul
  if not errorlevel 1 set "PNPM_CMD="pnpm.exe""
)
if not defined PNPM_CMD if exist "%APPDATA%\npm\pnpm.cmd" set "PNPM_CMD="%APPDATA%\npm\pnpm.cmd""
if not defined PNPM_CMD if exist "%USERPROFILE%\AppData\Roaming\npm\pnpm.cmd" set "PNPM_CMD="%USERPROFILE%\AppData\Roaming\npm\pnpm.cmd""
if not defined PNPM_CMD if exist "%ProgramFiles%\nodejs\pnpm.cmd" set "PNPM_CMD="%ProgramFiles%\nodejs\pnpm.cmd""
if not defined PNPM_CMD if exist "%LOCALAPPDATA%\pnpm\pnpm.exe" set "PNPM_CMD="%LOCALAPPDATA%\pnpm\pnpm.exe""
if not defined PNPM_CMD if exist "%ProgramFiles%\nodejs\corepack.cmd" set "PNPM_CMD=corepack pnpm"

if not defined PNPM_CMD (
  echo [ERROR] pnpm was not found.
  echo [ERROR] Install it once with:  npm install -g pnpm@9.15.0
  echo [ERROR] Then run this launcher again.
  goto :failed
)

echo [PromptHub] Using pnpm: %PNPM_CMD%
call %PNPM_CMD% --version
if errorlevel 1 (
  echo [ERROR] pnpm exists but could not be executed.
  goto :failed
)

if not exist "apps\desktop\package.json" (
  echo [ERROR] apps\desktop\package.json was not found.
  echo [ERROR] Keep this launcher in the PromptHub repository root.
  goto :failed
)

if not exist "apps\desktop\node_modules\electron\dist\electron.exe" (
  echo [PromptHub] Dependencies are missing. Installing locked workspace dependencies...
  call %PNPM_CMD% install --frozen-lockfile
  if errorlevel 1 goto :failed
)

echo [PromptHub] Building the current workspace...
call %PNPM_CMD% --filter @prompthub/desktop build
if errorlevel 1 goto :failed

if not exist "apps\desktop\out\main\index.js" (
  echo [ERROR] The Electron main build is missing.
  goto :failed
)
if not exist "apps\desktop\out\renderer\index.html" (
  echo [ERROR] The renderer build is missing.
  goto :failed
)

set "PROMPTHUB_TEST_ROOT=%TEMP%\qwenwork\PromptHub-native-manual-test"
set "HOME=%PROMPTHUB_TEST_ROOT%\home"
set "USERPROFILE=%PROMPTHUB_TEST_ROOT%\home"
set "APPDATA=%PROMPTHUB_TEST_ROOT%\home\AppData\Roaming"
set "LOCALAPPDATA=%PROMPTHUB_TEST_ROOT%\home\AppData\Local"
set "PROMPTHUB_E2E=1"
set "PROMPTHUB_E2E_USER_DATA_DIR=%PROMPTHUB_TEST_ROOT%\profile"
set "NODE_ENV=production"
set "ELECTRON_RUN_AS_NODE="

if not exist "%APPDATA%" mkdir "%APPDATA%"
if errorlevel 1 goto :failed
if not exist "%LOCALAPPDATA%" mkdir "%LOCALAPPDATA%"
if errorlevel 1 goto :failed
if not exist "%PROMPTHUB_E2E_USER_DATA_DIR%" mkdir "%PROMPTHUB_E2E_USER_DATA_DIR%"
if errorlevel 1 goto :failed

echo.
echo [PromptHub] Test data: %PROMPTHUB_E2E_USER_DATA_DIR%
echo [PromptHub] Starting the native application. Close its window to exit.
echo.

set "PROMPTHUB_MAIN_ENTRY=%~dp0apps\desktop\out\main\index.js"
set "PROMPTHUB_TEST_KEYRING=%~dp0apps\desktop\tests\e2e\helpers\isolated-keyring.cjs"
call "apps\desktop\node_modules\.bin\electron.cmd" -r "%PROMPTHUB_TEST_KEYRING%" "%PROMPTHUB_MAIN_ENTRY%"
set "APP_EXIT_CODE=%ERRORLEVEL%"

if not "%APP_EXIT_CODE%"=="0" (
  echo [ERROR] PromptHub exited with code %APP_EXIT_CODE%.
  goto :failed
)

echo [PromptHub] PromptHub closed normally.
endlocal
exit /b 0

:failed
echo.
echo [PromptHub] Startup failed. Review the messages above.
pause
endlocal
exit /b 1
