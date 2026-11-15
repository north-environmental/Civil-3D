@echo off
rem One-time setup: makes a private Python environment for this project (.venv)
rem and installs the three add-ons listed in requirements.txt.
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Creating the project's Python environment in .venv ...
  python -m venv .venv || goto :fail
)
echo Installing add-ons: numpy, shapely, tifffile ...
.venv\Scripts\python.exe -m pip install --disable-pip-version-check -q -r requirements.txt || goto :fail
echo.
echo Setup finished. You can now run:  package "1625 Heilmandale Rd, North Lebanon Township, PA"
exit /b 0
:fail
echo.
echo Setup did not finish. See the message above.
exit /b 1
