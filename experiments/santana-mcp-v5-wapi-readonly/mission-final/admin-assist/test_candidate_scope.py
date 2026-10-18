import ast,hashlib,json,unittest
from pathlib import Path
R=Path(__file__).resolve().parent
class Scope(unittest.TestCase):
    def test_manifest_is_exact_and_contains_only_fourteen_overlay_files(self):
        manifest=json.loads((R/'candidate-manifest.json').read_text());self.assertEqual(len(manifest['files']),14)
        for name,digest in manifest['files'].items():self.assertEqual(hashlib.sha256((R/'candidate'/name).read_bytes()).hexdigest(),digest)
        self.assertTrue(manifest['production_approval_required']);self.assertFalse(manifest['real_message_access_expanded'])
    def test_existing_outbound_transport_and_automation_are_not_in_overlay(self):
        names=json.loads((R/'candidate-manifest.json').read_text())['files']
        for name in names:self.assertNotIn('official_send_provider.py',name);self.assertNotIn('manual-whatsapp',name);self.assertNotIn('webhook',name);self.assertNotIn('workflow',name)
        sql=(R/'admin-access.sql').read_text().lower()
        self.assertNotIn('security definer',sql)
        for table in ['sana_conversations','sana_inbox_messages','sana_outbox','sana_cases','sana_documents']:
            self.assertNotIn('update public.'+table,sql);self.assertNotIn('insert into public.'+table,sql)
    def test_internal_media_actions_remain_behind_existing_caller_guard(self):
        source=(R/'candidate/prod-edge/index.ts').read_text()
        self.assertLess(source.index('if (!sameSecret('),source.index('return administrativeAttachment('))
        self.assertIn("return mcpOfficialOperation(request,body,service)",source)
    def test_all_candidate_python_files_compile_without_importing_or_contacting_services(self):
        for path in (R/'candidate/homolog-mcp').rglob('*.py'):ast.parse(path.read_text(),filename=str(path))
if __name__=='__main__':unittest.main()
