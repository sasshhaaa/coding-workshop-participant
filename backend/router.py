"""Local HTTP router exposing all service handlers for frontend development."""

import json
import sys
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
from importlib import import_module

PORT = 3002
BASE = os.path.dirname(os.path.abspath(__file__))

SERVICES = [
    "auth-service",
    "teams-service",
    "individuals-service",
    "projects-service",
    "achievements-service",
    "metadata-service",
]

HANDLERS = {}

for name in SERVICES:
    service_dir = os.path.join(BASE, name)
    if not os.path.isdir(service_dir):
        print(f"  skipping {name}: directory not found")
        continue
    sys.path.insert(0, service_dir)
    try:
        HANDLERS[name] = import_module("function").handler
    except Exception as e:
        print(f"  failed to load {name}: {e}")
    finally:
        # Drop cached modules so the next service loads its own copies.
        sys.modules.pop("function", None)
        sys.modules.pop("postgres_service", None)
        sys.path.pop(0)


class Router(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,Authorization")

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
            return self._send(404, json.dumps({
                "error": "Unknown service",
                "available": sorted(HANDLERS.keys()),
            }))

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

        # Pass the bearer token through so services can authorise the caller.
        auth = self.headers.get("Authorization")
        if auth:
            event["headers"] = {"Authorization": auth}

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
    print("Services:", ", ".join(sorted(HANDLERS.keys())))
    HTTPServer(("0.0.0.0", PORT), Router).serve_forever()