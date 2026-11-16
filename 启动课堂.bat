@echo off
cd /d "%~dp0"

if not exist "runtime\pythonw.exe" (
    echo [ERROR] runtime\pythonw.exe not found.
    pause
    exit /b 1
)

start "" "%~dp0runtime\pythonw.exe" "%~dp0launcher.py"
