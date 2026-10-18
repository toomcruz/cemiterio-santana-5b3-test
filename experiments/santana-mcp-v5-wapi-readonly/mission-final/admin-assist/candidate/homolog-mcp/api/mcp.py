"""Stateless Vercel entrypoint for the isolated, read-only HOMOLOG MCP."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
V5 = ROOT / "whatsapp-santana-mcp"
sys.path.insert(0, str(V5))

# Public, non-secret configuration for this one isolated ChatGPT OAuth client.
# The caller's short-lived OAuth JWT is forwarded to the HOMOLOG Edge Function;
# no service-role key, static MCP token, or message-write credential is present.
os.environ.update({
    "SANTANA_ADMIN_ASSIST_ENABLED": "true",
    "SANTANA_DATA_SOURCE": "sana_edge",
    "SANTANA_AUTHORIZED_CONTENT_DEFAULT": "true",
    "SANTANA_PREPARATION_ENABLED": "true",
    "SANTANA_SEND_ENABLED": "false",
    "SANTANA_SEND_MODE": "disabled",
    "SANTANA_AUDIT_DB": ":memory:",
    "SANA_READ_ENDPOINT": "https://xdccjulfqcqefykunwtg.supabase.co/functions/v1/sana-mcp-read",
    "CHATGPT_OAUTH_CLIENT_ID": "ccb5e1fc-2a61-4296-943a-a85c103e9313",
    "OPENBOT_OAUTH_CLIENT_ID": "",
    "MCP_PUBLIC_RESOURCE_URL": "https://santana-mcp-homolog-consent.vercel.app/mcp",
    "SANA_SUPABASE_AUTH_ISSUER": "https://xdccjulfqcqefykunwtg.supabase.co/auth/v1",
    "MCP_ALLOWED_ORIGINS": "https://chatgpt.com,https://chat.openai.com",
    "CHATGPT_WRITE_TOOLS": "",
    "OPENBOT_WRITE_TOOLS": "",
})

from server import Handler  # noqa: E402


class handler(Handler):
    """Vercel Python BaseHTTPRequestHandler entrypoint."""

    def _canonicalize_path(self) -> None:
        path = urlsplit(self.path).path
        if path in {"/api/mcp", "/mcp"}:
            self.path = "/mcp"
        elif path in {
            "/api/oauth-protected-resource",
            "/.well-known/oauth-protected-resource",
            "/.well-known/oauth-protected-resource/mcp",
        }:
            self.path = "/.well-known/oauth-protected-resource"

    def do_POST(self) -> None:
        self._canonicalize_path()
        super().do_POST()

    def do_GET(self) -> None:
        self._canonicalize_path()
        super().do_GET()

    def do_DELETE(self) -> None:
        super().do_DELETE()

    def log_message(self, fmt: str, *args) -> None:
        # Never log bearer tokens, message content, or caller IP addresses.
        return
