#!/usr/bin/env python3
"""Rebuild/qualify a fresh checkout using pinned private GHCR parents; never deploy."""
from pathlib import Path
import json
import os
import subprocess
import uuid

root = Path(__file__).resolve().parents[2]
source = root / 'hasterrad-game/source'
scripts = root / 'qualification/scripts'
builder = 'hasterrad-clean-' + uuid.uuid4().hex[:10]
images = {s: f'hasterrad-rebuild-{s}:0.4.11' for s in ('web', 'api')}
env = {**os.environ, **{f'HASTERRAD_{s.upper()}_IMAGE': tag for s, tag in images.items()}}

def run(args, cwd=root, **kwargs):
    subprocess.run(args, cwd=cwd, env=env, check=True, **kwargs)

# Refuse reuse of wallet build output. Run from a fresh checkout.
if (root / 'wallet/dist').exists():
    raise SystemExit('wallet/dist already exists; use a fresh checkout, not an overlay rebuild')
run(['python3', str(scripts / 'verify-registry.py')])
run(['npm', 'ci', '--ignore-scripts'])
run(['npm', 'test'])
run(['npm', 'ci', '--ignore-scripts'], cwd=root / 'wallet')
run(['npm', 'run', 'typecheck'], cwd=root / 'wallet')
run(['npm', 'run', 'build'], cwd=root / 'wallet')
run(['npm', 'test'], cwd=root / 'wallet')
run(['docker', 'compose', '-f', str(root / 'deployment/docker-compose.example.yml'), 'config', '--quiet'])
run(['docker', 'buildx', 'create', '--name', builder, '--driver', 'docker-container'])
try:
    for service, context in [('web', source), ('api', source / 'api')]:
        run(['docker', 'buildx', 'build', '--builder', builder, '--platform', 'linux/amd64',
             '--pull', '--no-cache', '--load', '--provenance=false', '-t', images[service], str(context)])
    run(['python3', str(scripts / 'check-copy.py')])
    run(['python3', str(scripts / 'verify-images.py')])
    run(['python3', str(scripts / 'runtime-check.py')])
    run(['docker', 'run', '--rm', '--platform', 'linux/amd64', '--network', 'none',
         '--mount', f'type=bind,src={scripts / "verify-image-replay.mjs"},dst=/app/verify-image-replay.mjs,readonly',
         '--entrypoint', 'node', images['api'], '/app/verify-image-replay.mjs'])
finally:
    run(['docker', 'buildx', 'rm', builder])
print(json.dumps({'qualified': True, 'deployed': False, 'images': images,
                  'wallet_bytes': 'match accepted release', 'image_identity': 'application-byte equivalent, not original image IDs'}))
