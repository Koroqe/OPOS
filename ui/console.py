"""OPOS Console — a tiny read-only HTTP server over the company OS files.

Usage:
    python3 ui/console.py [--port 8765] [--host 127.0.0.1] [--no-browser]

Reads markdown + JSON from the repo on every request. Defaults to loopback
binding. Ctrl-C stops cleanly.
"""

from __future__ import annotations

import argparse
import re
import sys
import time
import urllib.parse
import webbrowser
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Allow `python3 ui/console.py` to resolve `from ui import ...`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ui import handlers  # noqa: E402
from ui.validate import BadRequest  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = Path(__file__).resolve().parent / "static"

_STATIC_RE = re.compile(r"^/static/(?P<file>[A-Za-z0-9._-]+)$")
_STATIC_MIME = {
    ".css": "text/css; charset=utf-8",
    ".ico": "image/x-icon",
    ".js": "application/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
}


@dataclass
class Request:
    """Minimal request object passed to handlers."""

    path: str
    query: dict[str, str]
    path_params: dict[str, str]


class ConsoleHandler(BaseHTTPRequestHandler):
    server_version = "OPOSConsole/0.3.0"

    def log_message(self, fmt: str, *args) -> None:  # quieter than the default access log
        sys.stderr.write(f"[{time.strftime('%H:%M:%S')}] {self.address_string()} {fmt % args}\n")

    def do_GET(self) -> None:
        try:
            self._dispatch()
        except BadRequest as e:
            self._write(400, "text/html; charset=utf-8", f"<h1>400 Bad Request</h1><p>{e}</p>")
        except Exception as e:  # last-resort guard
            self._write(500, "text/html; charset=utf-8", f"<h1>500 Internal Server Error</h1><pre>{type(e).__name__}: {e}</pre>")

    def _dispatch(self) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        query = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))

        # Static files are served directly here (different content-types).
        m = _STATIC_RE.match(path)
        if m:
            self._serve_static(m.group("file"))
            return

        for pattern, handler in handlers.ROUTES:
            m = re.match(pattern, path)
            if not m:
                continue
            req = Request(path=path, query=query, path_params=m.groupdict())
            status, content_type, body = handler(req)
            self._write(status, content_type, body)
            return

        self._write(404, "text/html; charset=utf-8", f"<h1>404 Not Found</h1><p>{path}</p>")

    def _serve_static(self, filename: str) -> None:
        # safe because _STATIC_RE already restricts to [A-Za-z0-9._-]
        candidate = (STATIC_DIR / filename).resolve()
        if not candidate.is_file() or STATIC_DIR.resolve() not in candidate.parents:
            self._write(404, "text/plain; charset=utf-8", "not found")
            return
        suffix = candidate.suffix.lower()
        ctype = _STATIC_MIME.get(suffix, "application/octet-stream")
        data = candidate.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _write(self, status: int, content_type: str, body: str) -> None:
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> int:
    parser = argparse.ArgumentParser(description="OPOS Console — read-only company-OS browser.")
    parser.add_argument("--port", type=int, default=8765, help="Port to bind (default: 8765)")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--no-browser", action="store_true", help="Do not auto-open a browser")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), ConsoleHandler)
    url = f"http://{args.host}:{args.port}/"
    print(f"OPOS Console serving at {url}  (Ctrl-C to stop)")
    if not args.no_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
