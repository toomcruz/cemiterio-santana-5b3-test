"""Wire tests mount the extension in an isolated copy of the existing v5 server."""
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
import urllib.error
from unittest.mock import patch
from http.server import ThreadingHTTPServer

ROOT=Path(__file__).resolve().parent
from batch_send import Actor,BatchController,FixtureDirectory,SimulatedOfficialChannel
from mcp_extension import install,TOOLS,RESOURCE

class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory();work=Path(cls.temp.name)
        source=ROOT.parent/'mcp-deployment/whatsapp-santana-mcp'
        for p in source.glob('*.py'):shutil.copyfile(p,work/p.name)
        shutil.copyfile(ROOT/'backup/server.py',work/'server.py')
        for name in ('admin_assist_tools.py','attachment_worker.py'):
            shutil.copyfile(ROOT.parent/'admin-assist'/name,work/name)
        cls.tokens={name:secrets.token_urlsafe(36) for name in ('CHATGPT_READ_TOKEN','OPENBOT_READ_TOKEN')}
        cls.environment=patch.dict(os.environ,{**cls.tokens,'SANTANA_DATA_SOURCE':'fixture','SANTANA_SEND_MODE':'disabled','SANTANA_SEND_ENABLED':'false','SANTANA_AUDIT_DB':str(work/'state/v5.sqlite'),'CHATGPT_WRITE_TOOLS':'','OPENBOT_WRITE_TOOLS':'','SANTANA_ADMIN_ASSIST_ENABLED':'false'},clear=True)
        cls.environment.start();sys.path.insert(0,str(work))
        spec=importlib.util.spec_from_file_location('batch_isolated_existing_server',work/'server.py');cls.server_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.server_module)
        cls.channel=SimulatedOfficialChannel();cls.directory=FixtureDirectory()
        cls.clock=time.time
        cls.oauth=Actor('existing-subject','chatgpt-lab','existing-operator','oauth-lab','oauth',cls.clock()+3600,cls.clock())
        cls.human=Actor('existing-subject','chatgpt-lab','existing-operator','human-lab','human',cls.clock()+3600,cls.clock())
        cls.cookie=secrets.token_urlsafe(32)
        cls.engine=BatchController(cls.server_module.AUDIT,cls.directory,cls.channel,lambda actor:actor.session in {'oauth-lab','human-lab'},now=cls.clock)
        cls.httpd=ThreadingHTTPServer(('127.0.0.1',0),cls.server_module.Handler)
        cls.origin=f'http://127.0.0.1:{cls.httpd.server_port}'
        def resolve(identity,token):
            if identity[0]=='chatgpt':return cls.oauth
            if identity==('human',cls.cookie):return cls.human
            return None
        cls.httpd.RequestHandlerClass=install(cls.server_module,cls.engine,resolve,cls.origin)
        cls.thread=threading.Thread(target=cls.httpd.serve_forever,daemon=True);cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown();cls.thread.join();cls.httpd.server_close();cls.server_module.AUDIT._db.close()
        cls.environment.stop();sys.path.pop(0);cls.temp.cleanup()

    def post(self,path,body,headers=None):
        r=urllib.request.Request(self.origin+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream',**(headers or {})})
        try:response=urllib.request.urlopen(r,timeout=3)
        except urllib.error.HTTPError as e:response=e
        with response:return response.status,json.load(response)

    def mcp(self,method,params=None,client='CHATGPT_READ_TOKEN'):
        return self.post('/mcp',{'jsonrpc':'2.0','id':1,'method':method,'params':params or {}},{'Authorization':'Bearer '+self.tokens[client]})

    def prepare(self):
        status,value=self.mcp('tools/call',{'name':'preparar_envio_simplificado','arguments':{'recipient':'0001','text':'Oi, fictício '+self.id(),'idempotency_key':'http-key-'+secrets.token_hex(8)}})
        self.assertEqual(status,200);return value['result']['structuredContent']

    def test_new_tools_and_old_reads_coexist(self):
        status,value=self.mcp('tools/list');names={t['name'] for t in value['result']['tools']}
        self.assertTrue({t['name'] for t in TOOLS}<=names)
        self.assertTrue({'listar_conversas','consultar_mensagens','listar_arquivos'}<=names)
        status,value=self.mcp('tools/call',{'name':'listar_conversas','arguments':{}})
        self.assertEqual(status,200);self.assertNotEqual(value.get('result',{}).get('isError'),True)

    def test_openbot_sees_no_batch_tools_and_cannot_call_them(self):
        status,value=self.mcp('tools/list',client='OPENBOT_READ_TOKEN');names={t['name'] for t in value['result']['tools']}
        self.assertFalse({t['name'] for t in TOOLS}&names)
        status,value=self.mcp('tools/call',{'name':'preparar_lote','arguments':{}},client='OPENBOT_READ_TOKEN')
        self.assertEqual(value['error']['message'],'AGENT_SCOPE_DENIED')

    def test_resource_widget_is_available_without_approval_authority(self):
        status,value=self.mcp('resources/read',{'uri':RESOURCE})
        text=value['result']['contents'][0]['text']
        self.assertIn('ui/open-link',text);self.assertNotIn('approve_exact_synthetic_batch',text)

    def test_protected_review_single_click_then_mcp_execution(self):
        b=self.prepare();headers={'Origin':self.origin,'Sec-Fetch-Site':'same-origin','Cookie':'santana_lab_human='+self.cookie}
        status,p=self.post('/lab/review',{'action':'preview','batch_id':b['batch_id']},headers)
        self.assertEqual(status,200);self.assertIn('csrf_nonce',p);self.assertNotIn('csrf_nonce',b)
        status,a=self.post('/lab/review',{'action':'approve','batch_id':b['batch_id'],'manifest_sha256':b['manifest_sha256'],'csrf_nonce':p['csrf_nonce'],'explicit':'approve_exact_synthetic_batch'},headers)
        self.assertEqual(status,200);self.assertEqual(a['state'],'approved')
        status,result=self.mcp('tools/call',{'name':'executar_lote_simulado','arguments':{'batch_id':b['batch_id']}})
        self.assertEqual(result['result']['structuredContent']['state'],'accepted_by_api')

    def test_oauth_bearer_or_cross_origin_cannot_impersonate_browser_session(self):
        b=self.prepare()
        for headers in [dict(Origin=self.origin,**{'Sec-Fetch-Site':'same-origin','Authorization':'Bearer '+self.tokens['CHATGPT_READ_TOKEN']}),{'Origin':'https://evil.invalid','Sec-Fetch-Site':'cross-site','Cookie':'santana_lab_human='+self.cookie}]:
            status,value=self.post('/lab/review',{'action':'preview','batch_id':b['batch_id']},headers)
            self.assertEqual(status,403)

    def test_review_page_is_no_store_no_frame_and_has_no_credentials(self):
        with urllib.request.urlopen(self.origin+'/lab/revisar-lote') as r:
            self.assertEqual(r.headers['X-Frame-Options'],'DENY');self.assertEqual(r.headers['Cache-Control'],'no-store')
            html=r.read().decode();self.assertIn('Confirmar lote',html)
            self.assertNotIn(self.cookie,html);self.assertNotIn(self.tokens['CHATGPT_READ_TOKEN'],html)

if __name__=='__main__':unittest.main()
