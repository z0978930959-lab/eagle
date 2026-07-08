@echo off
setlocal
REM 讀入同目錄的 .env（若存在）
if exist "%~dp0.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%~dp0.env") do (
    if not "%%A"=="" if not "%%A:~0,1%"=="#" set "%%A=%%B"
  )
)
if "%PORT%"=="" set PORT=3000
if "%HOSTNAME%"=="" set HOSTNAME=0.0.0.0
echo Starting baseball-game on %HOSTNAME%:%PORT%
node "%~dp0server.js"
endlocal
