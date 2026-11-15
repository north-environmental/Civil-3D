@echo off
rem Make a site package.   Example:  package "1625 Heilmandale Rd, North Lebanon Township, PA"
rem Short names from packager\sites.json also work:  package heilmandale
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo The project's Python environment is missing. Run setup.cmd first.
  exit /b 1
)
.venv\Scripts\python.exe -m packager %*
