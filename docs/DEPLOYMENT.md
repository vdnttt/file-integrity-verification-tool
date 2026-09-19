# Deployment notes

## Local full stack

Use `python run.py` after compiling the C++20 engine.

The Python layer owns the HTTP API, SQLite storage, baseline management, comparison logic, history and report orchestration. The C++ layer exposes `--hash` and `--scan` commands and performs SHA-256 hashing of local files/directories.

## Cloudflare Pages

Deploy the `frontend` folder as a static Pages site.

Recommended Pages settings:

```text
Production branch: main
Build command: exit 0
Build output directory: frontend
```

Static Pages mode stores browser baselines/history in localStorage and hashes selected files in the browser. This makes the project deployable without requiring a separate Python server.
