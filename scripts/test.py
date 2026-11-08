#!/usr/bin/env python3
"""Focused source tests plus real local static HTTP checks; no external network."""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import threading
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


class References(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.refs = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in {'script', 'img', 'use'} and attrs.get('src', attrs.get('href')):
            self.refs.append(attrs.get('src', attrs.get('href')))
        if tag == 'link' and attrs.get('rel') == 'stylesheet':
            self.refs.append(attrs['href'])


def smoke(output):
    manifest = json.loads((output / 'artifact.json').read_text())
    files = manifest['files']
    assert set(files) == {str(p.relative_to(output)) for p in output.rglob('*') if p.is_file() and p.name != 'artifact.json'}
    for name, digest in files.items():
        assert hashlib.sha256((output / name).read_bytes()).hexdigest() == digest, name
        assert not any(word in name for word in ['auth-provider', 'hasterrad-scores', 'services/']), name
        if name.endswith('.html'):
            source = (output / name).read_text()
            for ref in References(source).refs:
                uri = urlsplit(ref)
                assert not uri.scheme and not uri.netloc, ref
                assert uri.path in files, (name, ref)
    server = runpy.run_path(str(ROOT / 'scripts/serve.py'))['server'](output)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{server.server_port}'
    try:
        for name in files:
            with urlopen(base + '/' + name) as response:
                assert response.status == 200
                assert response.read() == (output / name).read_bytes(), name
                assert response.headers['Cache-Control'] == 'no-store'
                csp = response.headers['Content-Security-Policy']
                assert "frame-src 'self'" in csp
                assert "frame-ancestors " + ("'self'" if name == 'asteroids.html' else "'none'") in csp
                assert response.headers['X-Content-Type-Options'] == 'nosniff'
                expected_types = {'.js': {'text/javascript', 'application/javascript'}, '.css': {'text/css'}, '.html': {'text/html'}, '.svg': {'image/svg+xml'}}
                if Path(name).suffix in expected_types:
                    assert response.headers.get_content_type() in expected_types[Path(name).suffix], name
        with urlopen(base + '/') as response:
            assert response.read() == (output / 'index.html').read_bytes()
        with urlopen(Request(base + '/asteroids.html?embedded=1', method='HEAD')) as response:
            assert response.status == 200 and response.read() == b''
            assert "frame-ancestors 'self'" in response.headers['Content-Security-Policy']
        for route in ['/api/session', '/auth/urbit/start', '/.env', '/../README.md', '/deferred/hasterrad-scores.js', '/artifact.json']:
            try:
                urlopen(base + route)
                raise AssertionError(f'Unexpected public route: {route}')
            except HTTPError as error:
                assert error.code == 404, (route, error.code)
        try:
            urlopen(Request(base + '/', data=b'test', method='POST'))
            raise AssertionError('POST must not be accepted')
        except HTTPError as error:
            assert error.code == 405
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    print(f'PASS: {len(files)} static files/hash/HTTP/MIME closure, root/query/HEAD, scoped same-origin CSP, private/auth routes 404 and POST 405')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game-artifact', type=Path, default=ROOT.parent / 'hasterrad/dist')
    args = parser.parse_args()
    for name in json.loads((ROOT / 'focused-tests.json').read_text()):
        subprocess.run(['node', str(ROOT / 'tests' / name)], cwd=ROOT, check=True)
    html_test = ROOT / 'tests/test_quantumtekh_com_html.py'
    if html_test.exists():
        subprocess.run([sys.executable, '-B', str(html_test), '-v'], cwd=ROOT, check=True)
    with tempfile.TemporaryDirectory(prefix='web-source-split-') as temp:
        temp = Path(temp)
        output = temp / 'artifact'
        command = [sys.executable, '-B', str(ROOT / 'scripts/build.py'), '--output', str(output)]
        if (ROOT / 'game-artifact.lock.json').exists():
            command.extend(['--game-artifact', str(args.game_artifact.resolve())])
        subprocess.run(command, check=True)
        smoke(output)
        # Identical inputs produce byte-identical content and manifests.
        second = temp / 'second'
        duplicate = command.copy()
        duplicate[duplicate.index('--output') + 1] = str(second)
        subprocess.run(duplicate, check=True)
        assert {str(p.relative_to(output)): p.read_bytes() for p in output.rglob('*') if p.is_file()} == {
            str(p.relative_to(second)): p.read_bytes() for p in second.rglob('*') if p.is_file()}
        print('PASS: deterministic repeat export; original source untouched')
        if (ROOT / 'game-artifact.lock.json').exists():
            import shutil
            bad = temp / 'tampered-game'
            shutil.copytree(args.game_artifact, bad)
            with (bad / 'assets/asteroids-core.js').open('ab') as stream:
                stream.write(b'\n// negative control\n')
            negative = command.copy()
            negative[negative.index('--output') + 1] = str(temp / 'must-not-exist')
            negative[negative.index('--game-artifact') + 1] = str(bad)
            result = subprocess.run(negative, capture_output=True, text=True)
            assert result.returncode != 0 and 'Game artifact hash mismatch' in result.stderr
            assert not (temp / 'must-not-exist').exists()
            print('PASS: tampered game artifact fails closed before website export')


if __name__ == '__main__':
    main()
