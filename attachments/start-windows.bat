@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run Edge Shipping.
  echo Install Node.js 20 or newer from https://nodejs.org/ and then run this file again.
  pause
  exit /b 1
)
rem Enable the local login helper. Real credentials configured in the environment are still respected.
set EDGE_LOCAL_MODE=1
if not exist data mkdir data
if not exist public\uploads mkdir public\uploads
echo.
echo =====================================================
echo   EDGE SHIPPING - U.S. SHIPPING PORTAL
echo =====================================================
echo Starting the server at http://127.0.0.1:3000
echo A browser tab will open automatically.
echo Keep this window open while using the website.
echo Press Ctrl+C to stop the server.
echo.
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:3000'"
node server.js
if errorlevel 1 (
  echo.
  echo The server stopped with an error. Make sure port 3000 is available.
  echo For another port, run: set PORT=3001 ^&^& node server.js
  pause
)
