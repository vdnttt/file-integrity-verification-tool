from __future__ import annotations

import json
import mimetypes
import os
import sqlite3
import subprocess
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / 'frontend'
DB_PATH = Path(os.environ.get('FIT_DB_PATH', ROOT / 'backend' / 'integrity.db'))
CPP_ENGINE = Path(os.environ.get('FIT_CPP_ENGINE', ROOT / 'cpp' / ('integrity_engine.exe' if os.name == 'nt' else 'integrity_engine')))
MAX_BODY = 20 * 1024 * 1024


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS baselines (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                file_count INTEGER NOT NULL,
                records_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                baseline_id TEXT,
                baseline_name TEXT,
                result_json TEXT NOT NULL
            );
        ''')


def compare_records(baseline_records: list[dict[str, Any]], current_records: list[dict[str, Any]]) -> dict[str, Any]:
    base = {r['path']: r for r in baseline_records}
    current = {r['path']: r for r in current_records}
    modified, added, deleted, unchanged = [], [], [], []
    for path, cur in sorted(current.items()):
        old = base.get(path)
        if old is None:
            added.append({**cur, 'status': 'ADDED'})
        elif old.get('hash') != cur.get('hash'):
            modified.append({'before': old, 'after': cur, 'status': 'MODIFIED'})
        else:
            unchanged.append({**cur, 'status': 'UNCHANGED'})
    for path, old in sorted(base.items()):
        if path not in current:
            deleted.append({**old, 'status': 'DELETED'})
    return {
        'status': 'PASS' if not modified and not added and not deleted else 'CHANGES_DETECTED',
        'summary': {'baseline': len(baseline_records), 'current': len(current_records), 'unchanged': len(unchanged), 'modified': len(modified), 'added': len(added), 'deleted': len(deleted)},
        'modified': modified, 'added': added, 'deleted': deleted, 'unchanged': unchanged,
    }


def ensure_records(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, list):
        raise ValueError('records must be a JSON array')
    result = []
    for item in payload:
        if not isinstance(item, dict) or 'path' not in item or 'hash' not in item:
            raise ValueError('each record must contain path and hash')
        result.append({'path': str(item['path']), 'hash': str(item['hash']), 'size': int(item.get('size', 0))})
    return result


def run_cpp(args: list[str]) -> dict[str, Any]:
    if not CPP_ENGINE.exists():
        raise RuntimeError(f'C++ engine not found at {CPP_ENGINE}. Compile cpp/integrity_engine.cpp first.')
    proc = subprocess.run([str(CPP_ENGINE), *args], capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or 'C++ engine failed')
    return json.loads(proc.stdout)


def json_bytes(obj: Any) -> bytes:
    return json.dumps(obj, ensure_ascii=False).encode('utf-8')


class Handler(BaseHTTPRequestHandler):
    server_version = 'FileIntegrityServer/1.0'

    def log_message(self, fmt: str, *args: Any) -> None:
        # Keep console output compact.
        print('%s - %s' % (self.address_string(), fmt % args))

    def _send_json(self, obj: Any, status: int = HTTPStatus.OK) -> None:
        data = json_bytes(obj)
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def _send_bytes(self, data: bytes, content_type: str, status: int = HTTPStatus.OK, cache: str = 'no-cache') -> None:
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', cache)
        self.end_headers()
        self.wfile.write(data)

    def _body(self) -> dict[str, Any]:
        length = int(self.headers.get('Content-Length', '0'))
        if length > MAX_BODY:
            raise ValueError('request body is too large')
        raw = self.rfile.read(length)
        if not raw:
            return {}
        payload = json.loads(raw.decode('utf-8'))
        if not isinstance(payload, dict):
            raise ValueError('JSON body must be an object')
        return payload

    def do_GET(self) -> None:
        path = unquote(urlparse(self.path).path)
        try:
            if path == '/api/health':
                return self._send_json({'ok': True, 'python': True, 'cpp_engine': CPP_ENGINE.exists(), 'cpp_engine_path': str(CPP_ENGINE), 'database': str(DB_PATH)})
            if path == '/api/baselines':
                with db() as conn:
                    rows = conn.execute('SELECT id,name,created_at,file_count FROM baselines ORDER BY created_at DESC').fetchall()
                return self._send_json([dict(r) for r in rows])
            if path.startswith('/api/baselines/'):
                baseline_id = path.rsplit('/', 1)[1]
                with db() as conn:
                    row = conn.execute('SELECT * FROM baselines WHERE id=?', (baseline_id,)).fetchone()
                if not row:
                    return self._send_json({'error': 'baseline not found'}, HTTPStatus.NOT_FOUND)
                payload = dict(row)
                payload['records'] = json.loads(payload.pop('records_json'))
                return self._send_json(payload)
            if path == '/api/history':
                with db() as conn:
                    rows = conn.execute('SELECT id,created_at,baseline_id,baseline_name,result_json FROM history ORDER BY created_at DESC LIMIT 50').fetchall()
                out = []
                for r in rows:
                    res = json.loads(r['result_json'])
                    out.append({'id': r['id'], 'created_at': r['created_at'], 'baseline_id': r['baseline_id'], 'baseline_name': r['baseline_name'], 'status': res.get('status'), 'summary': res.get('summary', {})})
                return self._send_json(out)
            if path.startswith('/api/history/'):
                history_id = path.rsplit('/', 1)[1]
                with db() as conn:
                    row = conn.execute('SELECT result_json FROM history WHERE id=?', (history_id,)).fetchone()
                if not row:
                    return self._send_json({'error': 'history item not found'}, HTTPStatus.NOT_FOUND)
                return self._send_json(json.loads(row['result_json']))
            return self._serve_static(path)
        except Exception as exc:
            return self._send_json({'error': str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_POST(self) -> None:
        path = unquote(urlparse(self.path).path)
        try:
            data = self._body()
            if path == '/api/server-scan':
                target = str(data.get('path', '')).strip()
                if not target:
                    return self._send_json({'error': 'path is required'}, HTTPStatus.BAD_REQUEST)
                return self._send_json(run_cpp(['--scan', target]))
            if path == '/api/hash-path':
                target = str(data.get('path', '')).strip()
                if not target:
                    return self._send_json({'error': 'path is required'}, HTTPStatus.BAD_REQUEST)
                return self._send_json(run_cpp(['--hash', target]))
            if path == '/api/baselines':
                records = ensure_records(data.get('records', []))
                name = str(data.get('name', 'Untitled Baseline')).strip() or 'Untitled Baseline'
                baseline_id, created = str(uuid.uuid4()), now_iso()
                with db() as conn:
                    conn.execute('INSERT INTO baselines VALUES (?,?,?,?,?)', (baseline_id, name, created, len(records), json.dumps(records)))
                return self._send_json({'id': baseline_id, 'name': name, 'created_at': created, 'file_count': len(records)})
            if path == '/api/verify':
                records = ensure_records(data.get('records', []))
                baseline_id = data.get('baseline_id')
                baseline_name = 'Imported / local baseline'
                if baseline_id:
                    with db() as conn:
                        row = conn.execute('SELECT name,records_json FROM baselines WHERE id=?', (baseline_id,)).fetchone()
                    if not row:
                        return self._send_json({'error': 'baseline not found'}, HTTPStatus.NOT_FOUND)
                    baseline_name = row['name']
                    baseline_records = json.loads(row['records_json'])
                else:
                    baseline_records = ensure_records(data.get('baseline_records', []))
                result = compare_records(baseline_records, records)
                history_id, created = str(uuid.uuid4()), now_iso()
                result.update({'id': history_id, 'created_at': created, 'baseline_id': baseline_id, 'baseline_name': baseline_name})
                with db() as conn:
                    conn.execute('INSERT INTO history VALUES (?,?,?,?,?)', (history_id, created, baseline_id, baseline_name, json.dumps(result)))
                return self._send_json(result)
            return self._send_json({'error': 'not found'}, HTTPStatus.NOT_FOUND)
        except (ValueError, json.JSONDecodeError) as exc:
            return self._send_json({'error': str(exc)}, HTTPStatus.BAD_REQUEST)
        except Exception as exc:
            return self._send_json({'error': str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_DELETE(self) -> None:
        path = unquote(urlparse(self.path).path)
        if path.startswith('/api/baselines/'):
            baseline_id = path.rsplit('/', 1)[1]
            with db() as conn:
                conn.execute('DELETE FROM baselines WHERE id=?', (baseline_id,))
            return self._send_json({'ok': True})
        return self._send_json({'error': 'not found'}, HTTPStatus.NOT_FOUND)

    def _serve_static(self, path: str) -> None:
        clean = path.lstrip('/')
        if clean and '..' not in Path(clean).parts:
            file_path = FRONTEND / clean
            if file_path.is_file():
                ctype, _ = mimetypes.guess_type(str(file_path))
                return self._send_bytes(file_path.read_bytes(), ctype or 'application/octet-stream')
        return self._send_bytes((FRONTEND / 'index.html').read_bytes(), 'text/html; charset=utf-8')


def run(host: str = '127.0.0.1', port: int = 5000) -> None:
    init_db()
    server = ThreadingHTTPServer((host, port), Handler)
    print(f'File Integrity Verification Tool running at http://{host}:{port}')
    print(f'C++ engine: {CPP_ENGINE}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopping server…')
    finally:
        server.server_close()


if __name__ == '__main__':
    run(os.environ.get('FIT_HOST', '127.0.0.1'), int(os.environ.get('FIT_PORT', '5000')))
