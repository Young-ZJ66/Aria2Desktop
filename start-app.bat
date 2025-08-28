@echo off
echo Starting Aria2 Desktop Application...

echo.
echo Step 1: Starting Vite development server...
start "Vite Server" cmd /k "npx vite --port 5173"

echo.
echo Step 2: Waiting for Vite server to start...
timeout /t 1 /nobreak > nul

echo.
echo Step 3: Starting Electron application...
set NODE_ENV=development
npx electron dist/electron/main.js

