"""Actual processes, scoped packages and SQLite; only systemd is simulated."""
import contextlib,hashlib,importlib.metadata,importlib.util,io,json,os,sqlite3,tempfile,time,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
import test_install_recovery as recovery
from build_ui_hardening import build

ROOT=Path(__file__).resolve().parent

class UIHardeningInstallTests(recovery.InstallerRecoveryTests):
    # Run only the three new transactions; the inherited installer scenarios
    # were already proven and are not repeated by the dedicated runner command.
    @classmethod
    def setUpClass(cls):
        cls.deps_temp=tempfile.TemporaryDirectory();cls.addClassCleanup(cls.deps_temp.cleanup)
        supplied=os.environ.get('SANTANA_REVIEW_TEST_DEPS_ZIP')
        cls.deps_zip=Path(supplied) if supplied else Path(cls.deps_temp.name)/'packages.zip'
        if supplied:return
        with zipfile.ZipFile(cls.deps_zip,'w',zipfile.ZIP_DEFLATED,compresslevel=1) as z:
            for package in ('Pillow','pypdfium2'):
                dist=importlib.metadata.distribution(package)
                for relative in dist.files:
                    if relative.is_absolute() or '..' in relative.parts or str(relative).endswith('.pyc'):continue
                    source=Path(dist.locate_file(relative))
                    if source.is_file():z.write(source,str(relative))
        cls.deps_zip.chmod(0o444)

    def hardener(self):
        self.assertEqual(self.run_install()['status'],'LAB_EXTENSION_INSTALLED')
        target=self.base/'santana_batch_lab'
        for p in (ROOT/'ui-hardening-backup').iterdir():
            if p.is_file():(target/p.name).write_bytes(p.read_bytes())
        for name in ('review_assets.py','review_media.py','attachment_worker.py'):(target/name).unlink()
        self.start(True)
        deadline=time.monotonic()+5
        while time.monotonic()<deadline and self.m.get_health()!=405:time.sleep(.05)
        code,manifest=build(self.deps_zip);path=self.work/'hardener.py';path.write_text(code)
        spec=importlib.util.spec_from_file_location('ui_hardener_under_test',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        for name in ('BASE_PATH','AUDIT_PATH','LAB_PORT','LAB_URL','STAGE','SYSTEMD_PATH','BACKUP_PATH'):setattr(module,name,getattr(self.m,name))
        self.stops=0
        def command(args,**kw):
            if args[:2]==['systemctl','stop']:
                self.assertEqual(args[2],self.m.UNIT);self.stops+=1;self.stop();return ''
            if args[:2]==['systemctl','start']:
                self.assertEqual(args[2],self.m.UNIT);self.start(True);return ''
            return self.command(args,**kw)
        module.command=command
        if not self.proc_env_available:
            module.process_env=self.m.process_env;module.process_ready=self.m.process_ready
        return module

    def run_hardener(self,module):
        out=io.StringIO()
        with patch.object(module.os,'geteuid',return_value=0),contextlib.redirect_stdout(out):
            try:module.main()
            except SystemExit as error:self.assertEqual(error.code,1)
        return json.loads(out.getvalue())

    def test_hardening_install_and_repeated_application_preserve_audit(self):
        module=self.hardener();result=self.run_hardener(module)
        self.assertEqual(result['status'],'LAB_UI_HARDENING_INSTALLED',result)
        self.assertEqual(result['pdf_offline_preview'],'PASS')
        self.assertTrue(result['lab_tunnel_pid_unchanged']);self.assertFalse(result['permissions_changed'])
        stops=self.stops;again=self.run_hardener(module)
        self.assertEqual(again['status'],'LAB_UI_HARDENING_ALREADY_INSTALLED',again);self.assertEqual(self.stops,stops)
        self.assertEqual(hashlib.sha256((self.base/'server.py').read_bytes()).hexdigest(),module.EXPECTED_SERVER)

    def test_hardening_health_failure_restores_original_and_unknown_operation(self):
        module=self.hardener();now=time.time()
        with sqlite3.connect(self.audit) as db:
            db.execute("INSERT INTO outbound_approvals(approval_id,client,kind,phone,payload_json,payload_hash,dedupe_key,state,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",('hardening-unknown','chatgpt','text','5511999900001','{}','a'*64,'hardening-unknown','outcome_unknown',now,now+600,now))
        module.verify_live=lambda env:(_ for _ in ()).throw(RuntimeError('SIMULATED_HEALTH_FAILURE'))
        result=self.run_hardener(module)
        self.assertEqual(result['status'],'LAB_UI_HARDENING_FAILED_RESTORED',result)
        self.assertTrue(result['lab_restored']);self.assertFalse((self.base/'santana_batch_lab/review-deps').exists())
        for name,sha in module.EXPECTED_FILES.items():self.assertEqual(hashlib.sha256((self.base/'santana_batch_lab'/name).read_bytes()).hexdigest(),sha)
        with sqlite3.connect(self.audit) as db:self.assertEqual(db.execute("select state from outbound_approvals where approval_id='hardening-unknown'").fetchone()[0],'outcome_unknown')

    def test_hardening_code_drift_stops_before_service_stop(self):
        module=self.hardener();module.EXPECTED_FILES['mcp_extension.py']='0'*64
        result=self.run_hardener(module)
        self.assertEqual(result['status'],'LAB_UI_HARDENING_STOPPED_NO_CHANGE',result)
        self.assertEqual(result['error_code'],'LAB_EXTENSION_CODE_DRIFT');self.assertEqual(self.stops,0)

def load_tests(loader,tests,pattern):
    return unittest.TestSuite(UIHardeningInstallTests(name) for name in (
        'test_hardening_install_and_repeated_application_preserve_audit',
        'test_hardening_health_failure_restores_original_and_unknown_operation',
        'test_hardening_code_drift_stops_before_service_stop'))

if __name__=='__main__':unittest.main()
