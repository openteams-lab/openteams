@echo off
REM Skills.sh Data Sync Script for Windows
REM Run this script periodically (e.g., via Task Scheduler) to keep skills data updated

setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set OUTPUT_FILE=%SCRIPT_DIR%..\skills_sh_data.json
set LOG_FILE=%SCRIPT_DIR%..\sync.log

REM Log function
echo [%date% %time%] Starting skills.sh sync... >> "%LOG_FILE%"

cd /d "%SCRIPT_DIR%.."

REM Build if needed
if not exist "scraper.exe" (
    echo [%date% %time%] Building scraper... >> "%LOG_FILE%"
    go build -o scraper.exe .\cmd\scraper
)

REM Run scraper
echo [%date% %time%] Running scraper... >> "%LOG_FILE%"
scraper.exe -output "%OUTPUT_FILE%" -verbose >> "%LOG_FILE%" 2>&1

REM Sync with API server (if running)
set API_URL=http://localhost:3101
echo [%date% %time%] Syncing with API server at %API_URL%... >> "%LOG_FILE%"

curl -s -X POST "%API_URL%/api/sync" >> "%LOG_FILE%" 2>&1

echo [%date% %time%] Sync complete! >> "%LOG_FILE%"