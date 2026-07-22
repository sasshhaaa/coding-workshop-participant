"""Local HTTP server exposing the Lambda handler for frontend development."""

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse
from function import handler

PORT = 3002


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _run(self, method):
        path = urlparse(self.path).path
        parts = [p for p in path.split("/") if p]
        record_id = parts[-1] if parts and parts[-1].isdigit() else None

        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode() if length else None

        event = {"httpMethod": method, "path": path}
        if body:
            event["body"] = body
        if record_id:
            event["pathParameters"] = {"id": record_id}

        try:
            result = handler(event)
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
            return

        payload = (result.get("body") or "").encode()

        self.send_response(result["statusCode"])
        for k, v in result.get("headers", {}).items():
            if k.lower().startswith("access-control-"):
                continue
            self.send_header(k, v)
        self._cors()
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

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
    print(f"Projects API on http://localhost:{PORT}")
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()