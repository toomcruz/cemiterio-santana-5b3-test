"""Per-component CSP, independent of the account's developer-mode settings."""
import base64
import hashlib
import re

AUTH_ORIGIN = 'https://xdccjulfqcqefykunwtg.supabase.co'

def protected_html(html):
    scripts = re.findall(r'<script>([\s\S]*?)</script>', html)
    styles = re.findall(r'<style>([\s\S]*?)</style>', html)
    if len(scripts) != 1 or len(styles) != 1 or 'http-equiv=' in html:
        raise ValueError('REVIEW_TEMPLATE_CHANGED')
    def source(value):
        return "'sha256-" + base64.b64encode(hashlib.sha256(value.encode()).digest()).decode() + "'"
    policy = "; ".join([
        "default-src 'none'", "script-src " + source(scripts[0]),
        "style-src " + source(styles[0]), "connect-src " + AUTH_ORIGIN,
        "img-src blob: data:", "frame-src 'none'", "object-src 'none'",
        "base-uri 'none'", "form-action 'none'",
    ])
    marker = '<meta charset="utf-8">'
    if html.count(marker) != 1:
        raise ValueError('REVIEW_TEMPLATE_CHANGED')
    return html.replace(marker, marker + '<meta http-equiv="Content-Security-Policy" content="' + policy + '">', 1)
