"""Same-origin authenticated review proxy. No provider or administrative keys."""
from http.server import BaseHTTPRequestHandler
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
import json
ORIGIN='https://santana-mcp-homolog-consent.vercel.app'
EDGE='https://xdccjulfqcqefykunwtg.supabase.co/functions/v1/sana-mcp-read'
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
class handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def reply(self,status,data):
        self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(json.dumps(data).encode())
    def do_POST(self):
        if self.headers.get('Origin')!=ORIGIN or self.headers.get('Sec-Fetch-Site')=='cross-site':return self.reply(403,{'status':'origin_denied'})
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=720000:return self.reply(413,{'status':'request_too_large'})
            body=json.loads(self.rfile.read(size))
            if not isinstance(body,dict):raise ValueError()
        except (ValueError,TypeError):return self.reply(400,{'status':'bad_request'})
        if body.get('action') not in {'human_preview','approve'} or 'mode' in body:return self.reply(403,{'status':'review_only'})
        auth=self.headers.get('Authorization','')
        if not auth.startswith('Bearer ') or len(auth)>16400:return self.reply(401,{'status':'unauthorized'})
        request=Request(EDGE,data=json.dumps({'mode':'send_intent',**body}).encode(),method='POST',headers={'Authorization':auth,'Content-Type':'application/json'})
        try:
            try:response=build_opener(NoRedirect).open(request,timeout=15)
            except HTTPError as error:response=error
            with response:
                raw=response.read(800001)
                if len(raw)>800000:raise ValueError()
                result=json.loads(raw)
                if not isinstance(result,dict):raise ValueError()
                return self.reply(response.status,result)
        except Exception:return self.reply(503,{'status':'review_unavailable'})
