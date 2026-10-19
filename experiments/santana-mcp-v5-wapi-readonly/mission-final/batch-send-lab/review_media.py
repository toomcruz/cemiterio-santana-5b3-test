"""Reuse the existing offline renderer, once per digest, with bounded output."""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from collections import OrderedDict

ROOT = Path(__file__).resolve().parent
MAX_PDF_PAGES = 8

class ReviewMedia:
    def __init__(self):
        self.cache = OrderedDict()
        self.lock = threading.Lock()

    def render_pdf(self, media):
        sha = media['sha256']
        with self.lock:
            if sha in self.cache:
                self.cache.move_to_end(sha)
                return self.cache[sha]
            try:
                value = self._render(media)
            except Exception:
                value = {'status': 'preview_unavailable', 'original_sha256': sha, 'images': [], 'complete': False}
            self.cache[sha] = value
            while len(self.cache) > 4:
                self.cache.popitem(last=False)
            return value

    def _render(self, media):
        images = []
        page_start = 1
        while True:
            payload = {k: media[k] for k in ('content_base64', 'mime_type', 'size_bytes', 'sha256')}
            payload.update(page_start=page_start, page_limit=2)
            # -I and an explicit package directory prevent inherited credentials,
            # user site packages, cwd imports and network access in the renderer.
            code = "import runpy,socket,sys;sys.path.insert(0,sys.argv[1]);socket.socket=lambda *a,**k:(_ for _ in ()).throw(RuntimeError('OFFLINE_ONLY'));runpy.run_path(sys.argv[2],run_name='__main__')"
            env = {k: os.environ[k] for k in ('PATH', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH') if k in os.environ}
            worker = ROOT / 'attachment_worker.py'
            result = subprocess.run([sys.executable, '-I', '-c', code, str(ROOT / 'review-deps'), str(worker)],
                input=json.dumps(payload), text=True, capture_output=True, timeout=10, env=env, cwd=ROOT)
            if result.returncode or len(result.stdout) > 2100000:
                raise ValueError('PDF_RENDER_UNAVAILABLE')
            value = json.loads(result.stdout)
            count = value.get('page_count')
            if value.get('status') != 'ready' or value.get('original_sha256') != media['sha256'] or type(count) is not int or not 1 <= count <= MAX_PDF_PAGES:
                raise ValueError('PDF_COMPLETE_PREVIEW_REQUIRED')
            for item in value['images']:
                raw = base64.b64decode(item['data'], validate=True)
                if not raw.startswith(b'\xff\xd8\xff') or len(raw) > 700000:
                    raise ValueError('PDF_PREVIEW_INTEGRITY')
                images.append({'page': item['page'], 'mime_type': 'image/jpeg', 'content_base64': item['data'],
                    'sha256': hashlib.sha256(raw).hexdigest(), 'size_bytes': len(raw)})
            if not value.get('has_more_pages'):
                break
            page_start = value.get('next_page_start')
            if type(page_start) is not int or page_start > MAX_PDF_PAGES:
                raise ValueError('PDF_COMPLETE_PREVIEW_REQUIRED')
        if [p['page'] for p in images] != list(range(1, count + 1)):
            raise ValueError('PDF_COMPLETE_PREVIEW_REQUIRED')
        return {'status': 'ready', 'original_sha256': media['sha256'], 'page_count': count, 'complete': True, 'images': images}
