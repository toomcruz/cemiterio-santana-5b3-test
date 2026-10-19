"""Installer transaction tests: real v5 processes/SQLite, simulated systemd only."""
import ast,contextlib,hashlib,importlib.util,io,json,os,secrets,shutil,socket,sqlite3,subprocess,sys,tempfile,time,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request,urlopen

ROOT=Path(__file__).resolve().parent
FILES={n:(ROOT/n).read_text() for n in ['batch_send.py','mcp_extension.py','real_review.py','launcher.py','review.html','widget.html','real-widget.html']}

class InstallerRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.work=Path(self.temp.name);self.base=self.work/'base';self.base.mkdir()
        archive=ROOT.parents[1]/'WhatsApp-Santana-MCP-v5-Consolidado.zip'
        if not archive.exists():archive=Path('/home/runner/santana-mcp-staging/63a85c509957532a/WhatsApp-Santana-MCP-v5-Consolidado.zip')
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(),'63a85c509957532a8091f0ad13b5a5423a0dfeb19a007310bac1f0943f27b6ee')
        with zipfile.ZipFile(archive) as z:
            for info in z.infolist():
                p=Path(info.filename)
                if p.parts[0]=='whatsapp-santana-mcp' and len(p.parts)==2 and p.suffix=='.py':(self.base/p.name).write_bytes(z.read(info))
        reference=ROOT/'auth-backup/installed-payload-reference.py'
        if not reference.exists():reference=ROOT.parents[1]/'root-payload.py'
        tree=ast.parse(reference.read_text())
        for node in tree.body:
            if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='PATCHES' for t in node.targets):
                for n,v in ast.literal_eval(node.value).items():
                    if len(Path(n).parts)==1 and Path(n).suffix=='.py':(self.base/n).write_text(v)
        with socket.socket() as s:s.bind(('127.0.0.1',0));self.port=s.getsockname()[1]
        self.audit=self.work/'state'/'audit.sqlite3';self.audit.parent.mkdir()
        self.env={k:os.environ[k] for k in ('PATH','LANG','LD_LIBRARY_PATH') if k in os.environ}
        self.env.update({k:secrets.token_urlsafe(36) for k in ('CHATGPT_READ_TOKEN','OPENBOT_READ_TOKEN')})
        self.env.update(MCP_PORT=str(self.port),SANTANA_DATA_SOURCE='fixture',SANTANA_SEND_ENABLED='false',SANTANA_SEND_MODE='disabled',SANTANA_AUDIT_DB=str(self.audit),PYTHONDONTWRITEBYTECODE='1')
        self.proc=None;self.restarts=0;self.delay=0;self.candidate_env={};self.addCleanup(self.stop)
        spec=importlib.util.spec_from_file_location('installer_recovery',ROOT/'root-install-template.py');self.m=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.m)
        self.m.FILES=FILES;self.m.BASE_PATH=str(self.base);self.m.AUDIT_PATH=str(self.audit);self.m.LAB_PORT=self.port;self.m.LAB_URL=f'http://127.0.0.1:{self.port}/mcp'
        self.m.STAGE=self.work/'stage';self.m.STAGE.mkdir();self.m.SYSTEMD_PATH=self.work/'systemd';self.m.BACKUP_PATH=self.work/'backups';self.m.SYSTEMD_PATH.mkdir()
        self.m.previous_error_metadata=lambda:[]
        self.command_real=self.m.command;self.m.command=self.command
        self.start(False)
        deadline=time.monotonic()+5
        while time.monotonic()<deadline and self.m.get_health()!=405:time.sleep(.05)
        self.assertEqual(self.m.get_health(),405)
        try:
            self.m.process_env(str(self.proc.pid));self.proc_env_available=True
        except (PermissionError,FileNotFoundError):
            # The local Work runtime can prohibit /proc/.../environ. The VPS
            # runner must exercise the real read; its validation rejects skips.
            self.proc_env_available=False;self.m.process_env=lambda pid:dict(self.env)
            self.m.process_ready=lambda pid,script:self.m.get_health()==405
    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:self.proc.kill();self.proc.wait()
    def start(self,candidate):
        self.stop()
        script=self.base/'santana_batch_lab'/'launcher.py' if candidate else self.base/'server.py'
        env={**self.env,**(self.candidate_env if candidate else {})}
        args=[sys.executable,str(script)]
        if candidate and self.delay:
            # Real PID, initially running an executor with an incomplete env,
            # then execve the configured service in that SAME PID.
            code="import os,sys,json,time;v=json.load(sys.stdin);time.sleep("+str(self.delay)+");os.execve(sys.executable,[sys.executable,v['script']],v['env'])"
            self.proc=subprocess.Popen([sys.executable,'-c',code],cwd=self.base,env={'PATH':self.env['PATH']},stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,text=True)
            self.proc.stdin.write(json.dumps({'script':str(script),'env':env}));self.proc.stdin.close()
        else:self.proc=subprocess.Popen(args,cwd=self.base,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    def command(self,args,**kw):
        if args==['hostname']:return 'srv1849463'
        if args[0]=='nsenter':return self.command_real(args[4:],**kw)
        if args[0]=='/usr/bin/python3':return self.command_real(args,**kw)
        if args[:2]==['systemctl','daemon-reload']:return ''
        if args[:2]==['systemctl','restart']:
            self.assertEqual(args[2],self.m.UNIT);self.restarts+=1
            self.start((self.m.SYSTEMD_PATH/(self.m.UNIT+'.d')/'90-batch-lab.conf').exists());return ''
        if args[:2]==['systemctl','show']:
            unit=args[2];name=args[4]
            if unit=='santana-mcp-lab-tunnel.service':return '1234'
            return {'WorkingDirectory':str(self.base),'MainPID':str(self.proc.pid),'StateDirectory':'santana-mcp-lab','ActiveState':'active' if self.proc.poll() is None else 'failed'}[name]
        raise AssertionError('Unexpected command')
    def run_install(self):
        out=io.StringIO()
        with patch.object(self.m.os,'geteuid',return_value=0),contextlib.redirect_stdout(out):
            try:self.m.main()
            except SystemExit as e:self.assertEqual(e.code,1)
        return json.loads(out.getvalue())
    def test_real_process_catalog_and_persistent_ledger_after_slow_start(self):
        self.delay=1.9;before=(self.base/'server.py').read_bytes();r=self.run_install()
        self.assertEqual(r['status'],'LAB_EXTENSION_INSTALLED',r);self.assertEqual(len(r['tools']),12)
        self.assertEqual(r['mount_and_existing_audit_preflight'],'PASS');self.assertFalse(r['permissions_changed'])
        self.assertEqual((self.base/'server.py').read_bytes(),before)
        with sqlite3.connect(self.audit) as db:self.assertIn(('lab_real_reviews',),db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall())
        self.assertEqual(self.restarts,1);self.assertEqual(r['whatsapp_sends'],0)
    def test_existing_audit_incompatibility_stops_before_service_restart(self):
        with sqlite3.connect(self.audit) as db:db.execute('CREATE TABLE lab_batch_clock(unexpected TEXT)')
        r=self.run_install();self.assertEqual(r['status'],'INSTALL_STOPPED_NO_CHANGE')
        self.assertEqual(r['phase'],'preflight_in_existing_lab_mount_namespace');self.assertEqual(r['child_exception_type'],'OperationalError')
        self.assertEqual(self.restarts,0);self.assertEqual(self.m.get_health(),405)
        self.assertFalse((self.base/'santana_batch_lab').exists())
    def test_http_auth_failure_restores_old_service_without_retries(self):
        self.m.catalog=lambda env:(_ for _ in ()).throw(HTTPError(self.m.LAB_URL,401,'secret-sentinel',{},None))
        r=self.run_install();self.assertEqual(r['status'],'INSTALL_FAILED_LAB_RESTORED_NO_PRODUCTION_CHANGE',r)
        self.assertTrue(r['lab_restored']);self.assertEqual(r['http_status'],401);self.assertEqual(self.restarts,2)
        self.assertNotIn('secret-sentinel',json.dumps(r));self.assertEqual(self.m.get_health(),405)
    def test_failure_metadata_does_not_expose_credentials(self):
        secret='sensitive-value-not-for-output'
        e=subprocess.CalledProcessError(1,['secret',secret],stderr='Traceback\n  File "/root/x/launcher.py", line 12\nsqlite3.OperationalError: attempt to write a readonly database '+secret)
        r=self.m.safe_error(e);self.assertEqual(r['error_code'],'READ_ONLY_STORAGE');self.assertEqual(r['child_exception_type'],'OperationalError')
        self.assertNotIn(secret,json.dumps(r));self.assertEqual(r['frames'],[{'file':'launcher.py','line':12}])
    def test_existing_runtime_lock_blocks_second_process_on_same_ledger(self):
        r=self.run_install();self.assertEqual(r['status'],'LAB_EXTENSION_INSTALLED',r)
        with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
        child=subprocess.run([sys.executable,str(self.base/'santana_batch_lab'/'launcher.py')],cwd=self.base,env={**self.env,'MCP_PORT':str(port)},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5)
        self.assertNotEqual(child.returncode,0);self.assertEqual(self.proc.poll(),None)
        self.assertEqual(len(self.m.catalog(self.env)),12)
    def test_restart_preserves_ambiguous_dispatch_as_unknown(self):
        r=self.run_install();self.assertEqual(r['status'],'LAB_EXTENSION_INSTALLED',r)
        now=time.time()
        with sqlite3.connect(self.audit) as db:
            db.execute("INSERT INTO outbound_approvals(approval_id,client,kind,phone,payload_json,payload_hash,dedupe_key,state,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",('synthetic-ambiguous','chatgpt','text','5511999900001','{}','a'*64,'synthetic-only','sending',now,now+600,now))
        self.start(True)
        deadline=time.monotonic()+5
        while time.monotonic()<deadline and self.m.get_health()!=405:time.sleep(.05)
        self.assertEqual(self.m.get_health(),405)
        with sqlite3.connect(self.audit) as db:self.assertEqual(db.execute('SELECT state FROM outbound_approvals WHERE approval_id=?',('synthetic-ambiguous',)).fetchone()[0],'outcome_unknown')
    def test_legacy_check_reproduces_reported_error_before_exec(self):
        if not self.proc_env_available:self.skipTest('Real child environ unavailable in this runtime')
        self.delay=1
        def legacy(script,seconds=15):return self.m.catalog(self.m.process_env(self.m.property('MainPID')))
        self.m.await_catalog=legacy
        r=self.run_install();self.assertEqual(r['error_code'],'LAB_RUNTIME_CONFIGURATION_CHANGED',r)
        self.assertFalse(r['configuration_checks']['audit_variable_present']);self.assertTrue(r['lab_restored'])
    def test_genuine_audit_configuration_change_is_still_blocked(self):
        if not self.proc_env_available:self.skipTest('Real child environ unavailable in this runtime')
        self.candidate_env={'SANTANA_AUDIT_DB':str(self.work/'other.sqlite3')}
        r=self.run_install();self.assertEqual(r['error_code'],'LAB_RUNTIME_CONFIGURATION_CHANGED',r)
        self.assertTrue(r['configuration_checks']['audit_variable_present']);self.assertFalse(r['configuration_checks']['audit_path_matches'])
        self.assertTrue(r['lab_restored']);self.assertEqual(self.restarts,2)
    def test_private_tool_descriptor_is_app_only_without_render_resource(self):
        r=self.run_install();self.assertEqual(r['status'],'LAB_EXTENSION_INSTALLED',r)
        body=json.dumps({'jsonrpc':'2.0','id':1,'method':'tools/list','params':{}}).encode()
        req=Request(self.m.LAB_URL,data=body,headers={'Authorization':'Bearer '+self.env['CHATGPT_READ_TOKEN'],'Content-Type':'application/json','Accept':'application/json, text/event-stream'})
        with urlopen(req,timeout=3) as response:v=json.load(response)
        tools={t['name']:t for t in v['result']['tools']}
        self.assertEqual(len(tools),12)
        self.assertEqual(tools['registrar_revisao_lote']['_meta']['ui'],{'visibility':['app']})
        for n in ('preparar_envio_simplificado','preparar_lote'):
            self.assertEqual(tools[n]['_meta']['ui']['resourceUri'],'ui://santana/lab-batch-review.html')
    def ui_fix_module(self):
        r=self.run_install();self.assertEqual(r['status'],'LAB_EXTENSION_INSTALLED',r)
        (self.base/'santana_batch_lab'/'mcp_extension.py').write_text((ROOT/'ui-fix-backup/mcp_extension.py').read_text())
        self.start(True)
        deadline=time.monotonic()+5
        while time.monotonic()<deadline and self.m.get_health()!=405:time.sleep(.05)
        spec=importlib.util.spec_from_file_location('ui_fix_transaction',ROOT/'fix-ui-metadata.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        for name in ('BASE_PATH','AUDIT_PATH','LAB_PORT','LAB_URL','STAGE','SYSTEMD_PATH','BACKUP_PATH'):setattr(module,name,getattr(self.m,name))
        module.command=self.command
        if not self.proc_env_available:
            module.process_env=self.m.process_env;module.process_ready=self.m.process_ready
        return module
    def run_ui_fix(self,module):
        out=io.StringIO()
        with patch.object(module.os,'geteuid',return_value=0),contextlib.redirect_stdout(out):
            try:module.main()
            except SystemExit as e:self.assertEqual(e.code,1)
        return json.loads(out.getvalue())
    def test_installed_metadata_patch_is_minimal_and_idempotent(self):
        module=self.ui_fix_module();r=self.run_ui_fix(module)
        self.assertEqual(r['status'],'LAB_UI_METADATA_FIXED',r)
        self.assertEqual(r['private_visibility'],['app']);self.assertFalse(r['private_render_resource'])
        self.assertTrue(r['lab_tunnel_pid_unchanged']);self.assertEqual(self.restarts,2)
        again=self.run_ui_fix(module);self.assertEqual(again['status'],'LAB_UI_METADATA_ALREADY_FIXED',again)
        self.assertEqual(self.restarts,2)
    def test_installed_metadata_patch_restores_original_on_failed_health(self):
        module=self.ui_fix_module()
        module.catalog=lambda env:(_ for _ in ()).throw(HTTPError(module.LAB_URL,401,'fixture-only',{},None))
        r=self.run_ui_fix(module);self.assertEqual(r['status'],'LAB_UI_FIX_FAILED_RESTORED',r)
        self.assertTrue(r['lab_restored']);self.assertEqual(r['http_status'],401)
        self.assertEqual(hashlib.sha256((self.base/'santana_batch_lab'/'mcp_extension.py').read_bytes()).hexdigest(),module.OLD_SHA)

if __name__=='__main__':unittest.main()
