#!/usr/bin/env python3
"""Real web→API proxy gate for replay-sized bodies (no login or score writes)."""
import urllib.request
import urllib.error

origin = 'http://127.0.0.1:18789'
headers = {'Host': 'hasterrad.quantumtekh.com', 'Origin': 'https://hasterrad.quantumtekh.com', 'Content-Type': 'application/json'}
body = b'{"proof":"' + b'x' * 33940 + b'"}'

def status(path):
    request = urllib.request.Request(origin + path, data=body, headers=headers, method='POST')
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code

finish = status('/api/runs/' + 'A' * 43 + '/finish')
other = status('/auth/logout')
assert finish == 401, f'large replay must reach API auth gate, got HTTP {finish}'
assert other == 413, f'unrelated requests must retain proxy body cap, got HTTP {other}'
print(f'replay-sized body reaches API auth gate: HTTP {finish}; unrelated route remains capped: HTTP {other}')
