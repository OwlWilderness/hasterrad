#!/usr/bin/env python3
"""Disposable loopback-only static preview. No account or deployment backend."""
import argparse
import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


def server(directory, port=0):
    directory = directory.resolve()
    manifest = json.loads((directory / 'artifact.json').read_text())['files']

    class Static(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

        def respond(self, head=False):
            route = unquote(urlsplit(self.path).path)
            name = 'index.html' if route == '/' else route.removeprefix('/')
            allowed = name in manifest and not any(part.startswith('.') or part == '..' for part in Path(name).parts)
            path = directory / name
            status = 200 if allowed and path.is_file() and not path.is_symlink() else 404
            body = path.read_bytes() if status == 200 else b'Not found\n'
            self.send_response(status)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            ancestors = "'self'" if name == 'asteroids.html' else "'none'"
            # Same-origin game only; never proxy or activate account authentication.
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https:; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors " + ancestors)
            self.send_header('Content-Type', mimetypes.guess_type(name)[0] or 'application/octet-stream')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            if not head:
                self.wfile.write(body)

        def do_GET(self):
            self.respond()

        def do_HEAD(self):
            self.respond(head=True)

        def do_POST(self):
            self.send_error(405)

    return ThreadingHTTPServer(('127.0.0.1', port), Static)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=ROOT / 'dist')
    parser.add_argument('--port', type=int, default=0)
    args = parser.parse_args()
    httpd = server(args.directory, args.port)
    print(f'http://127.0.0.1:{httpd.server_port}/', flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
