#!/usr/bin/env python3
"""Compare each built static asset and API server module with the frozen source."""
from pathlib import Path
import hashlib
import json
import shlex
import subprocess

root = Path(__file__).resolve().parents[2] / 'hasterrad-game' / 'source'
manifest = json.loads((root / 'public' / 'artifact.json').read_text())['files']

def check(image, directory, expected):
    files = list(expected)
    args = ' '.join(shlex.quote(x) for x in files)
    cmd = ['docker', 'run', '--rm', '--platform', 'linux/amd64', '--entrypoint', '/bin/sh', image, '-c', f'cd {shlex.quote(directory)} && sha256sum {args}']
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    actual = {}
    for line in result.stdout.splitlines():
        digest, path = line.split('  ', 1)
        actual[path] = digest
    assert actual == expected, f'Image content mismatch in {image}: {set(actual) ^ set(expected) or [x for x in expected if actual[x] != expected[x]]}'
    print(f'{image}: {len(expected)} exact source hashes')

for service, directory in [('web', '/content/current'), ('api', '/app/public')]:
    check(f'{service}.hasterrad-game.public.dappnode.eth:0.4.11', directory, manifest)
server = root / 'api' / 'server'
modules = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in server.glob('*.mjs')}
check('api.hasterrad-game.public.dappnode.eth:0.4.11', '/app/server', modules)
expected_proxy = hashlib.sha256((root / 'live.conf').read_bytes()).hexdigest()
proxy = subprocess.run(['docker', 'run', '--rm', '--platform', 'linux/amd64', '--network', 'none',
                        '--entrypoint', '/bin/sh', 'web.hasterrad-game.public.dappnode.eth:0.4.11',
                        '-c', 'sha256sum /etc/nginx/live.conf'], check=True, capture_output=True, text=True)
assert proxy.stdout.split()[0] == expected_proxy, 'web image does not carry the reviewed replay-body limit'
print('web.hasterrad-game.public.dappnode.eth:0.4.11: exact proxy configuration hash')
