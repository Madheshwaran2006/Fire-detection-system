@echo off
echo Starting Fire Detection Dashboard...
echo.

echo [1/2] Starting FastAPI backend on http://localhost:8000
start "Fire Detection API" cmd /k "cd /d F:\ML\backend && python -m uvicorn api:app --reload --port 8000"

timeout /t 3 /nobreak >nul

echo [2/2] Starting React frontend on http://localhost:5173
start "Fire Detection UI" cmd /k "cd /d F:\ML\frontend && npm run dev"

timeout /t 3 /nobreak >nul

echo.
echo Dashboard running at: http://localhost:5173
echo API running at:        http://localhost:8000
echo.
start http://localhost:5173
