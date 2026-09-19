@echo off
setlocal
if not exist cpp\integrity_engine.exe (
  g++ -std=c++20 -O2 -Wall -Wextra -pedantic cpp\integrity_engine.cpp -o cpp\integrity_engine.exe
  if errorlevel 1 exit /b 1
)
python run.py
endlocal
