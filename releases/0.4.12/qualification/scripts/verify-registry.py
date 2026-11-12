#!/usr/bin/env python3
"""Pull the private preserved images by digest; verify identity, never deploy."""
from pathlib import Path
import json
import subprocess

root = Path(__file__).resolve().parents[2]
lock = json.loads((root / 'images.lock.json').read_text())
for name, image in lock['images'].items():
    subprocess.run(['docker', 'pull', '--platform', lock['platform'], image['reference']], check=True)
    data = json.loads(subprocess.check_output(['docker', 'image', 'inspect', image['reference']]))[0]
    assert data['Id'] == image['imageId'], name
    assert data['Os'] + '/' + data['Architecture'] == lock['platform'], name
    print(f"PASS {name}: {data['Id']}", flush=True)
