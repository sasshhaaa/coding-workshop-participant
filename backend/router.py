"""Local HTTP router exposing all service handlers for frontend development."""

import json
import sys
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
from importlib import import_module

PORT = 3002
BASE = os.path.dirname(os.path.abspath(__file__))

SERVICES = ["teams-service", "individuals-service"]
HANDLERS = {}

for name in SERVICES:
    sys.path.insert(0, os.path.join(BASE, name))
    HANDLERS[name] = import_module("function").handler
    del sys.modules["function"]
    del sys.modules["postgres_service"]
    sys.path.pop(0)


class Router(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send(self, status, payload):
        data = payload.encode() if isinstance(payload, str) else payload
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _run(self, method):
        parsed = urlparse(self.path)
        parts = [p for p in parsed.path.split("/") if p]

        service = next((p for p in parts if p in HANDLERS), None)
        if not service:
            return self._send(404, json.dumps({"error": "Unknown service"}))

        tail = parts[parts.index(service) + 1:]
        record_id = tail[-1] if tail and tail[-1].isdigit() else None

        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode() if length else None

        event = {"httpMethod": method, "path": parsed.path}
        if body:
            event["body"] = body
        if record_id:
            event["pathParameters"] = {"id": record_id}
        if parsed.query:
            event["queryStringParameters"] = {
                k: v[0] for k, v in parse_qs(parsed.query).items()
            }

        try:
            result = HANDLERS[service](event)
        except Exception as e:
            return self._send(500, json.dumps({"error": str(e)}))

        self._send(result["statusCode"], result.get("body") or "")

    def do_GET(self): self._run("GET")
    def do_POST(self): self._run("POST")
    def do_PUT(self): self._run("PUT")
    def do_DELETE(self): self._run("DELETE")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, fmt, *args):
        print(f"{self.command} {self.path}")


if __name__ == "__main__":
    print(f"API on http://localhost:{PORT}")
    print("Services:", ", ".join(SERVICES))
    HTTPServer(("0.0.0.0", PORT), Router).serve_forever()