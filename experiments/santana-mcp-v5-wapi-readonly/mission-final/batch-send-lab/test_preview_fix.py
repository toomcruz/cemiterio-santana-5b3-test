"""Actual loopback MCP reads and atomic files; privileged operations simulated."""
import contextlib,hashlib,importlib.util,io,json,shutil,tempfile,threading,unittest
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from build_preview_fix import build,R

class PreviewFixTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.work=Path(self.tmp.name)
        self.base=self.work/'existing-lab';self.target=self.base/'santana_batch_lab';self.target.mkdir(parents=True)
        self.path=self.target/'real-widget.html';self.original=(R/'media-preview-backup.html').read_text();self.path.write_text(self.original)
        shutil.copy2(R/'review_assets.py',self.target/'review_assets.py')
        (self.base/'server.py').write_text('# synthetic existing server')
        self.audit=self.work/'audit.sqlite3';self.audit.write_bytes(b'synthetic-audit-must-not-change')
        code,_=build();payload=self.work/'apply.py';payload.write_text(code)
        spec=importlib.util.spec_from_file_location('preview_fix_under_test',payload);self.m=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.m)
        self.m.BASE_PATH=str(self.base);self.m.EXPECTED_SERVER=hashlib.sha256((self.base/'server.py').read_bytes()).hexdigest()
        self.m.AUDIT_PATH=str(self.audit);self.m.BACKUP_PATH=self.work/'backups';self.m.STAGE=self.work
        self.m.command=lambda args,**kw:'srv1849463' if args==['hostname'] else self.fail('Unexpected service/subprocess action')
        self.m.property=lambda name,unit='santana-mcp-lab.service':str(self.base) if name=='WorkingDirectory' else '41' if unit=='santana-mcp-lab.service' else '42'
        env={'SANTANA_AUDIT_DB':str(self.audit),'MCP_PORT':'8770','SANTANA_DATA_SOURCE':'fixture','SANTANA_SEND_ENABLED':'false','SANTANA_SEND_MODE':'disabled','CHATGPT_READ_TOKEN':'synthetic-only'}
        self.m.process_env=lambda pid:dict(env);self.resource_reads=0;self.bad_new_resource=False
        case=self
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                if self.headers.get('Authorization')!='Bearer synthetic-only':self.send_error(401);return
                q=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if q['method']=='tools/list':
                    value={'tools':[{'name':n} for n in ['preparar_lote','registrar_revisao_lote','listar_conversas']]}
                else:
                    case.resource_reads+=1;html=case.path.read_text()
                    if case.bad_new_resource and html!=case.original:html=case.original;case.bad_new_resource=False
                    value={'contents':[{'text':case.m.protected(html,case.target)}]}
                data=json.dumps({'jsonrpc':'2.0','id':1,'result':value}).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(data)
            def log_message(self,*a):pass
        self.http=ThreadingHTTPServer(('127.0.0.1',0),Handler);self.addCleanup(self.http.server_close)
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start();self.addCleanup(self.http.shutdown)
        self.m.LAB_URL='http://127.0.0.1:'+str(self.http.server_port)+'/mcp'

    def run_fix(self):
        output=io.StringIO()
        with patch.object(self.m.os,'geteuid',return_value=0),contextlib.redirect_stdout(output):
            try:self.m.main()
            except SystemExit as e:self.assertEqual(e.code,1)
        return json.loads(output.getvalue())

    def test_one_file_live_update_and_idempotence_without_restart_or_audit_change(self):
        result=self.run_fix();self.assertEqual(result['status'],'LAB_PREVIEW_COMPAT_FIXED',result)
        self.assertEqual(result['services_restarted'],0);self.assertTrue(result['lab_pid_unchanged']);self.assertTrue(result['lab_tunnel_pid_unchanged'])
        self.assertEqual(self.path.read_text(),self.m.PATCHED_HTML);self.assertEqual(self.audit.read_bytes(),b'synthetic-audit-must-not-change')
        self.assertEqual(self.run_fix()['status'],'LAB_PREVIEW_COMPAT_ALREADY_FIXED');self.assertEqual(len(list(self.m.BACKUP_PATH.iterdir())),1)

    def test_failed_live_resource_verification_restores_original_without_restart(self):
        self.bad_new_resource=True;result=self.run_fix()
        self.assertEqual(result['status'],'LAB_PREVIEW_FIX_FAILED_RESTORED',result);self.assertTrue(result['lab_restored'])
        self.assertEqual(self.path.read_text(),self.original);self.assertEqual(self.audit.read_bytes(),b'synthetic-audit-must-not-change');self.assertEqual(self.resource_reads,2)

    def test_code_drift_stops_before_backup_or_write(self):
        self.path.write_text('unrecognized current widget');result=self.run_fix()
        self.assertEqual(result['error_code'],'LAB_WIDGET_CODE_DRIFT');self.assertEqual(self.resource_reads,0)
        self.assertFalse(self.m.BACKUP_PATH.exists());self.assertEqual(self.path.read_text(),'unrecognized current widget')

if __name__=='__main__':unittest.main()
