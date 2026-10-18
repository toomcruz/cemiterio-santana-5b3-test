import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from install import select_install_entries, stage_transaction, apply_transaction, restore_transaction


class PatchScopeTests(unittest.TestCase):
    def test_incremental_install_and_rollback_preserve_unselected_local_changes(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);source=root/'source';target=root/'active'
            source.mkdir();target.mkdir()
            (source/'server.py').write_text('new code')
            (source/'other.py').write_text('old unrelated code')
            (target/'server.py').write_text('old code')
            (target/'other.py').write_text('local unrelated code')
            (target/'.env.example').write_text('local configuration template')
            entries={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in source.iterdir()}
            (source/'MANIFEST.json').write_text(json.dumps({'install_files':['server.py']}))
            selected=select_install_entries(source,entries)
            changes=stage_transaction(source,target,root/'backup',selected)
            self.assertEqual([c['path'] for c in changes],['server.py'])
            apply_transaction(source,target,changes)
            self.assertEqual((target/'server.py').read_text(),'new code')
            self.assertEqual((target/'other.py').read_text(),'local unrelated code')
            self.assertEqual((target/'.env.example').read_text(),'local configuration template')
            restore_transaction(target,root/'backup',changes)
            self.assertEqual((target/'server.py').read_text(),'old code')
            self.assertEqual((target/'other.py').read_text(),'local unrelated code')

    def test_incremental_scope_rejects_config_paths_missing_files_and_empty_lists(self):
        with tempfile.TemporaryDirectory() as td:
            source=Path(td)
            for selection in [[],['.env'],['missing.py'],['server.py','server.py'],42]:
                (source/'MANIFEST.json').write_text(json.dumps({'install_files':selection}))
                with self.assertRaises(RuntimeError):
                    select_install_entries(source,{'server.py':'hash','.env':'hash'})
