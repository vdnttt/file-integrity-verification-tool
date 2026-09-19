import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / 'cpp' / 'integrity_engine'
SAMPLE = ROOT / 'sample_data' / 'config.txt'

expected = hashlib.sha256(SAMPLE.read_bytes()).hexdigest()
result = subprocess.check_output([str(ENGINE), '--hash', str(SAMPLE)], text=True)
payload = json.loads(result)
actual = payload['files'][0]['hash']
assert actual == expected, (actual, expected)
assert payload['algorithm'] == 'SHA-256'
assert payload['count'] == 1
print('Smoke test passed.')
