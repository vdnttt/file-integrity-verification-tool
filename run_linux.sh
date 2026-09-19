#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
if [ ! -x "$ROOT/cpp/integrity_engine" ]; then
  g++ -std=c++20 -O2 -Wall -Wextra -pedantic "$ROOT/cpp/integrity_engine.cpp" -o "$ROOT/cpp/integrity_engine"
fi
python3 "$ROOT/run.py"
