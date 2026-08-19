@echo off
REM ---------------------------------------------------------------------------
REM Run the org-owner backfill against a database whose URL lives in a file.
REM
REM Exists because passing a Postgres URL on a Windows command line is a
REM minefield: PowerShell blocks npx.ps1 under the default execution policy,
REM long lines wrap and break, and the URL's own punctuation gets interpreted
REM by the shell. Reading it from a file sidesteps all three.
REM
REM The URL file lives OUTSIDE the repository, so it cannot be committed —
REM this repo is public.
REM
REM   1. Put the connection string on one line in:  %USERPROFILE%\prod-url.txt
REM   2. Double-click this file, or run it from a terminal.
REM   3. Add --apply as an argument once the dry-run report looks right.
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0.."

if not exist "%USERPROFILE%\prod-url.txt" (
  echo.
  echo   Could not find "%USERPROFILE%\prod-url.txt"
  echo   Create it in Notepad, paste the postgres:// URL on one line, save.
  echo.
  pause
  exit /b 1
)

set /p DBURL=<"%USERPROFILE%\prod-url.txt"

if "%DBURL%"=="" (
  echo   The file is empty. Paste the postgres:// URL into it and save.
  pause
  exit /b 1
)

set "PRISMA_DATABASE_URL=%DBURL%"
set "DATABASE_URL=%DBURL%"

echo.
echo   Running the backfill (dry run unless you passed --apply)...
echo.

call npx.cmd tsx scripts/backfill-org-owners.ts %*

echo.
echo   Done. Copy the report above.
echo.
pause
endlocal
