#!/usr/bin/env python3
"""Export the guest-only static artifact; no network, SDK or container calls."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build(output):
    public = ROOT / 'public'
    files = json.loads((ROOT / 'source-files.json').read_text())
    payload = {}
    for name in files:
        path = public / name
        if path.is_symlink() or not path.is_file() or '..' in Path(name).parts:
            raise ValueError(f'Invalid explicit public input: {name}')
        payload[name] = path.read_bytes()
    # Standalone root mirrors the original exporter's homepage backlink adaptation.
    payload['index.html'] = payload['asteroids.html'].replace(
        b'href="index.html"', b'href="https://quantumtekh.com/"')
    output.mkdir(parents=True, exist_ok=False)
    for name, data in payload.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    manifest = {name: hashlib.sha256(data).hexdigest() for name, data in sorted(payload.items())}
    (output / 'artifact.json').write_text(json.dumps({
        'format': 1, 'mode': 'guest-only', 'files': manifest
    }, sort_keys=True, indent=2) + '\n')
    print(f'Exported {len(payload)} public files to {output}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    build(parser.parse_args().output.resolve())
