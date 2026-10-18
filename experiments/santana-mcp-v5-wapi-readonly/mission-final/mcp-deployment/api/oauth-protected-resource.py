"""Public OAuth resource metadata for the separately authenticated MCP."""
from http.server import BaseHTTPRequestHandler
import json


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        payload = {
            "resource": "https://santana-mcp-homolog-consent.vercel.app/mcp",
            "authorization_servers": ["https://xdccjulfqcqefykunwtg.supabase.co/auth/v1"],
            "scopes_supported": ["openid", "email", "profile"],
            "bearer_methods_supported": ["header"],
        }
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        self.send_response(405)
        self.send_header("Allow", "GET")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, fmt, *args):
        return
