"""Dev server for Shardlight: serves web/ with no caching and the right MIME type for .wasm.

    python serve.py          -> http://localhost:8140

Dev only: POST /__shot?name=x.png saves the request body (a PNG) to ./shots/, so a test can
capture the 3D canvas at full resolution.
"""
import http.server, functools, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        m = re.match(r'^/__shot\?name=([\w.-]+\.png)$', self.path)
        if not m or self.client_address[0] not in ('127.0.0.1', '::1'):
            self.send_error(404); return
        data = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        os.makedirs(os.path.join(ROOT, 'shots'), exist_ok=True)
        with open(os.path.join(ROOT, 'shots', m.group(1)), 'wb') as f:
            f.write(data)
        self.send_response(204); self.end_headers()

port = int(os.environ.get('PORT', 8140))
http.server.ThreadingHTTPServer(('', port), functools.partial(Handler, directory=os.path.join(ROOT, 'web'))).serve_forever()
