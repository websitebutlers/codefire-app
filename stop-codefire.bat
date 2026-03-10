@echo off
echo Stopping CodeFire...

taskkill /F /IM electron.exe >nul 2>&1 && echo   Killed electron.exe || echo   No electron.exe found

:: Kill Vite dev servers holding ports 5173-5175
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5173 :5174 :5175" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%p >nul 2>&1 && echo   Killed Vite server PID %%p
)

echo Done.
