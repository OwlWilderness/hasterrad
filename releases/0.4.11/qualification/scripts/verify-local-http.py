#!/usr/bin/env python3
"""Read-only validation of the isolated web→API container pair."""
from pathlib import Path
import hashlib
import json
import urllib.request

root = Path(__file__).resolve().parents[2] / 'hasterrad-game' / 'source'
manifest = json.loads((root / 'public' / 'artifact.json').read_text())['files']
open_local = urllib.request.build_opener(urllib.request.ProxyHandler({})).open

def get(path):
    request = urllib.request.Request('http://127.0.0.1:18789/' + path,
        headers={'Host': 'hasterrad.quantumtekh.com'})
    with open_local(request, timeout=5) as response:
        assert response.status == 200, (path, response.status)
        return response.read()

for path, expected in manifest.items():
    digest = hashlib.sha256(get(path)).hexdigest()
    assert digest == expected, ('served asset mismatch', path)
board = json.loads(get('api/leaderboard'))
assert board['board'] == [] and board['version'] == 'hasterrad-3'
session = json.loads(get('api/session'))
assert session['providers'] == {'urbit': False, 'remilianet': False, 'wallet': False}
assert session['authenticated'] is False
print(f'{len(manifest)} served assets match the manifest through web→API; empty board and guest-only test providers verified')
