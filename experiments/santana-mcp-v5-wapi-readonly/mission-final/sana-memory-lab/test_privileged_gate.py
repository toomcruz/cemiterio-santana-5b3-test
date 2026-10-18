import hashlib,os,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import root_template as gate

class PrivilegedGateTests(unittest.TestCase):
    def test_changed_source_stops_before_backup_or_service_change(self):
        with patch.object(gate.os,'getuid',return_value=0),patch.object(gate,'verify_sources',side_effect=RuntimeError('ACTIVE_SOURCE_CHANGED_NO_WRITE')),patch.object(gate,'backup') as backup,patch.object(gate.subprocess,'run') as command:
            with self.assertRaisesRegex(RuntimeError,'ACTIVE_SOURCE_CHANGED'):gate.main()
            backup.assert_not_called();command.assert_not_called()
    def test_unproven_native_result_never_installs(self):
        with patch.object(gate.os,'getuid',return_value=0),patch.object(gate,'verify_sources'),patch.object(gate,'service_pids',return_value={}),patch.object(gate,'service_env',return_value={}),patch.object(gate,'probe',return_value={'result_available':False}),patch.object(gate,'PREFLIGHT',{},create=True),patch.object(gate,'backup') as backup,patch.object(gate.subprocess,'run') as command:
            r=gate.main();self.assertEqual(r['status'],'NATIVE_RESULT_NOT_PROVEN_NO_CHANGE');backup.assert_not_called();command.assert_not_called()
    def test_nonroot_cannot_make_changes(self):
        with patch.object(gate.os,'getuid',return_value=1001),patch.object(gate,'verify_sources') as check:
            with self.assertRaisesRegex(RuntimeError,'ROOT_REQUIRED'):gate.main()
            check.assert_not_called()
    def test_atomic_mode_is_readable_by_service_even_with_private_umask(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'server.py';old=os.umask(0o077)
            try:gate.atomic(p,b'synthetic')
            finally:os.umask(old)
            self.assertEqual(p.stat().st_mode&0o777,0o644);self.assertEqual(p.read_bytes(),b'synthetic')
    def test_atomic_refuses_symlink_target(self):
        with tempfile.TemporaryDirectory() as td:
            target=Path(td)/'target';target.write_bytes(b'unchanged');link=Path(td)/'link';link.symlink_to(target)
            with self.assertRaisesRegex(RuntimeError,'UNSAFE_TARGET'):gate.atomic(link,b'changed')
            self.assertEqual(target.read_bytes(),b'unchanged')
    def test_backup_is_required_before_any_service_stop(self):
        with tempfile.TemporaryDirectory() as td:
            saved=Path(td)/'backup';saved.mkdir();events=[]
            def backup(_):events.append('backup');return saved
            def command(args,**kwargs):
                if args[:2]==['systemctl','stop']:self.assertIn('backup',events)
                events.append(' '.join(args[:2]));return SimpleNamespace(returncode=0)
            proof={'result_available':True,'marker_verified':True,'source':'openbot_local_scripts_delivery'}
            old=os.umask(0o022)
            try:
                with patch.object(gate.os,'getuid',return_value=0),patch.object(gate,'verify_sources'),patch.object(gate,'service_pids',return_value={'openbot':'42'}),patch.object(gate,'service_env',return_value={}),patch.object(gate,'probe',return_value=proof),patch.object(gate,'PREFLIGHT',{},create=True),patch.object(gate,'PATCHES',{},create=True),patch.object(gate,'idle_queue',return_value=Path(td)/'db'),patch.object(gate,'backup',side_effect=backup),patch.object(gate.subprocess,'run',side_effect=command):
                    r=gate.main();self.assertEqual(r['status'],'LAB_RESULT_PATCH_INSTALLED');self.assertTrue(r['unchanged_service_pids'])
            finally:os.umask(old)

if __name__=='__main__':unittest.main()
