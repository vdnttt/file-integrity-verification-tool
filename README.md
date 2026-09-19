# File Integrity Verification Tool

A OOP project that combines a **C++20 hashing engine (~25% of the application)** with a **Python backend and SQLite (~75%)**, plus a polished browser UI.

The project is designed for two modes:

1. **Local full-stack mode:** Browser UI → Python backend → C++20 engine → SQLite. This mode supports scanning a server/local path through C++ and persisting baselines/history in SQLite.
2. **Cloudflare Pages mode:** The UI runs as a static site. Files selected in the browser are hashed locally with the browser's Web Crypto SHA-256 implementation, and baselines/history are stored in browser `localStorage`. This is the deployment mode for Cloudflare Pages.

Cloudflare Pages supports static HTML sites without a framework, so this repository keeps a self-contained `frontend/` directory for deployment.

## Features

- Select individual files or a complete folder from the browser.
- Compute SHA-256 for every selected file.
- Create named integrity baselines.
- Verify a new scan against a baseline.
- Detect **modified**, **added**, **deleted**, and **unchanged** files.
- Local Python API with SQLite persistence.
- C++20 server-side folder scanner for local deployments.
- JSON report export.
- Baseline JSON import.
- Search/filter current scan records.
- Verification history.
- Light/dark UI.
- Responsive layout for laptop/tablet/mobile.
- OOP-focused C++ classes showing abstraction, inheritance, virtual functions, protected data, static members, constructors/destructors and encapsulation.

## Project structure

```text
file-integrity-tool/
├── cpp/
│   ├── integrity_engine.cpp
│   └── integrity_engine              # compiled local executable (Linux/macOS in this workspace)
├── backend/
│   ├── app.py
│   ├── requirements.txt
│   └── integrity.db                  # created automatically on first local run
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── sample_data/
│   ├── config.txt
│   └── readme.txt
├── tests/
│   └── smoke_test.py
├── run.py
├── run_linux.sh
├── run_windows.bat
├── Makefile
├── .gitignore
└── README.md
```

## OOP mapping

| College topic | Project implementation |
|---|---|
| Class / Object | `HashAlgorithm`, `SHA256Hasher`, `FileRecord`, `Scanner` |
| Data abstraction | `HashAlgorithm` exposes hashing through a pure virtual interface |
| Encapsulation | `FileRecord` keeps file details behind member functions |
| Information hiding | SHA-256 helper operations are `private` |
| Inheritance | `SHA256Hasher : public HashAlgorithm`, `RegularFileRecord : public FileRecord` |
| Polymorphism | Virtual `name()`, `hashFile()`, `kind()` |
| Protected members | `FileRecord` stores path/hash/size as `protected` |
| Constructor / destructor | Explicit constructors and virtual destructors |
| Static member | `Scanner::scannedCount_` |
| Function prototype | Member function declarations/definitions |
| Passing object | `Scanner` receives a `HashAlgorithm` reference |
| Returning objects | `Scanner::scan()` returns `std::vector<RegularFileRecord>` |
| Inline-style small methods | Getter/name methods are defined inside the class |
| Abstract class | `HashAlgorithm` is abstract because it has pure virtual functions |

## Run locally

### 1. Compile the C++20 engine

Linux/macOS:

```bash
make
```

Or directly:

```bash
g++ -std=c++20 -O2 -Wall -Wextra -pedantic cpp/integrity_engine.cpp -o cpp/integrity_engine
```

Windows (MinGW):

```bat
g++ -std=c++20 -O2 -Wall -Wextra -pedantic cpp/integrity_engine.cpp -o cpp\integrity_engine.exe
```

### 2. Create a Python environment

```bash
python -m venv .venv
```

Linux/macOS:

```bash
source .venv/bin/activate
```

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

### 3. Install Python dependencies

```bash
pip install -r backend/requirements.txt
```

### 4. Start the application

```bash
python run.py
```

Open:

```text
http://127.0.0.1:5000
```

Or use the helper script:

```bash
./run_linux.sh
```

On Windows:

```bat
run_windows.bat
```

## Testing the C++ engine

Hash a file:

```bash
./cpp/integrity_engine --hash sample_data/config.txt
```

Scan a directory:

```bash
./cpp/integrity_engine --scan sample_data
```

The executable prints JSON so the Python layer can consume it directly.

## How to demonstrate the project

1. Open the UI.
2. Select `sample_data` as a folder.
3. Click **Calculate SHA-256**.
4. Give the snapshot a name such as `Initial Baseline` and save it.
5. Change `sample_data/config.txt`.
6. Run a new scan.
7. Click **Verify current scan**.
8. The dashboard will show the changed file under **Modified**.
9. Add another file to show **Added**, or delete a file to show **Deleted**.
10. Export the verification report as JSON.

## Deploy to GitHub + Cloudflare Pages

The `/frontend` folder is intentionally self-contained, so it can be deployed as a static site. In Cloudflare Pages, connect the GitHub repository and use:

- **Production branch:** `main`
- **Build command:** `exit 0`
- **Build output directory:** `frontend`

Use the Pages Git integration to connect the GitHub repository and automatically deploy pushed commits.

### Git commands

```bash
git init
git add .
git commit -m "Initial File Integrity Verification Tool"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/file-integrity-verification-tool.git
git push -u origin main
```

Then in Cloudflare:

**Workers & Pages → Create application → Pages → Import an existing Git repository**.

The deployed site will receive a `*.pages.dev` address.

### Important cloud limitation

A Cloudflare Pages static deployment does **not** run your local Flask process or local C++ executable. The cloud version therefore uses the same UI and performs SHA-256 in the browser. The full Python + C++ path scanner remains available when you run the repository locally.

This split is deliberate: it keeps the project genuinely deployable on Pages while still making C++ and Python the main implementation for the full local version.
