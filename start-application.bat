@echo off
setlocal

set "APP_ROOT=%~dp0"
set "BACKEND_DIR=%APP_ROOT%backend"
set "FRONTEND_DIR=%APP_ROOT%frontend"

if not exist "%BACKEND_DIR%\main.py" (
    echo ERROR: Backend was not found at "%BACKEND_DIR%".
    pause
    exit /b 1
)

if not exist "%FRONTEND_DIR%\package.json" (
    echo ERROR: Frontend was not found at "%FRONTEND_DIR%".
    pause
    exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not available in PATH.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm is not available in PATH.
    pause
    exit /b 1
)

if not exist "%FRONTEND_DIR%\node_modules" (
    echo ERROR: Frontend dependencies are missing. Run npm ci in the frontend folder.
    pause
    exit /b 1
)

netstat -ano | findstr /R /C:"127.0.0.1:8000 .*LISTENING" >nul
if errorlevel 1 (
    echo Starting TPI backend on http://127.0.0.1:8000 ...
    start "TPI Backend" /D "%BACKEND_DIR%" cmd /k "set ENV=development&&set REDIS_URL=redis://127.0.0.1:6379&&set PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True&&python -m uvicorn main:app --host 127.0.0.1 --port 8000"
) else (
    echo Backend is already running on port 8000.
)

netstat -ano | findstr /R /C:"127.0.0.1:5173 .*LISTENING" >nul
if errorlevel 1 (
    echo Starting TPI frontend on http://127.0.0.1:5173 ...
    start "TPI Frontend" /D "%FRONTEND_DIR%" cmd /k "npm run dev -- --host 127.0.0.1 --port 5173"
) else (
    echo Frontend is already running on port 5173.
)

echo Waiting for the application to initialize ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$limit=(Get-Date).AddSeconds(30); do { $backend=$false; $frontend=$false; try { $backend=((Invoke-RestMethod -TimeoutSec 2 'http://127.0.0.1:8000/health').status -eq 'ok') } catch {}; try { $frontend=((Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:5173').StatusCode -eq 200) } catch {}; if ($backend -and $frontend) { exit 0 }; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $limit); exit 1"
if errorlevel 1 (
    echo.
    echo ERROR: The application did not become ready within 30 seconds.
    echo Review the TPI Backend and TPI Frontend windows for the exact error.
    pause
    exit /b 1
)

start "" "http://127.0.0.1:5173"

echo.
echo TPI application started.
echo Frontend: http://127.0.0.1:5173
echo Backend:  http://127.0.0.1:8000
echo Logs:     %APP_ROOT%logs
echo.
echo Keep the TPI Backend and TPI Frontend windows open while using the application.
pause
endlocal
