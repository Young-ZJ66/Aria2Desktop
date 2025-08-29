@echo off
echo Starting Aria2 Desktop Development Environment...

echo.
echo Using optimized npm run dev command with concurrently...
echo This will start both Vue development server and Electron application.
echo.

echo Starting development environment...
npm run dev

echo.
echo Development environment has exited.
echo Press any key to close this window...
pause > nul