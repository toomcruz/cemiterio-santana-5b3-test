"""Isolated transport stubs: no credentials, network, user data or sends."""
import json,sys,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'candidate/homolog-mcp/whatsapp-santana-mcp'))
from sana_read_provider import SanaReadProvider,OAuthAuthenticationError,AdministrativeReadError
from admin_assist_tools import call_admin
CID='20000000-0000-4000-8000-000000000001'
ARGS={'conversation_id':CID,'message_key':'synthetic-message','artifact_id':'synthetic-artifact','page_start':1}
TOKEN='e30.e30.synthetic'
class SafeErrors(unittest.TestCase):
    def provider(self,status,data):
        calls=[]
        def transport(endpoint,token,body,timeout,**kwargs):calls.append(body);return status,data
        return SanaReadProvider('https://synthetic.supabase.co/functions/v1/sana-mcp-read','',transport,forward_bearer=True),calls
    def test_exact_scope_denial_is_visible_as_denied_and_never_retried_or_rendered(self):
        p,calls=self.provider(403,{'status':'MCP_ADMIN_ATTACHMENT_DENIED','private':'DO_NOT_RELEASE'})
        with patch('admin_assist_tools.render_attachment') as render:r=call_admin(p,'ler_anexo_autorizado',ARGS,TOKEN)
        self.assertTrue(r['isError']);self.assertEqual(r['structuredContent']['error_code'],'MCP_ADMIN_ATTACHMENT_DENIED')
        self.assertEqual(r['structuredContent']['status'],'denied');self.assertEqual(len(calls),1);render.assert_not_called();self.assertNotIn('DO_NOT_RELEASE',json.dumps(r))
    def test_timeout_unavailable_size_and_rate_are_distinct_without_upstream_payloads(self):
        for status,code in [(504,'MCP_ADMIN_ATTACHMENT_TIMEOUT'),(404,'MCP_ADMIN_ATTACHMENT_UNAVAILABLE'),(413,'MCP_ADMIN_ATTACHMENT_TOO_LARGE'),(429,'MCP_ADMIN_RATE_LIMITED')]:
            with self.subTest(code=code):
                p,calls=self.provider(status,{'status':code,'retry_after_seconds':12,'query':'PRIVATE_SQL','token':'PRIVATE_TOKEN'})
                r=call_admin(p,'ler_anexo_autorizado',ARGS,TOKEN);d=r['structuredContent']
                self.assertEqual(d['error_code'],code);self.assertEqual(d['http_status'],status);self.assertFalse(d['automatic_retry']);self.assertFalse(d['send_allowed']);self.assertEqual(len(calls),1);self.assertNotIn('PRIVATE',json.dumps(r))
    def test_unknown_upstream_error_is_sanitized(self):
        p,_=self.provider(503,{'status':'private-debug-token-and-query','sql':'private'})
        r=call_admin(p,'ler_anexo_autorizado',ARGS,TOKEN);self.assertEqual(r['structuredContent']['error_code'],'MCP_ADMIN_UPSTREAM_UNAVAILABLE');self.assertNotIn('private',json.dumps(r))
    def test_oauth_authentication_failure_still_requires_the_existing_auth_boundary(self):
        p,calls=self.provider(401,{'status':'unauthorized'})
        with self.assertRaises(OAuthAuthenticationError):call_admin(p,'ler_anexo_autorizado',ARGS,TOKEN)
        self.assertEqual(len(calls),1)
    def test_render_dependency_failure_is_explicit_and_does_not_release_bytes_or_auth(self):
        p,calls=self.provider(200,{'status':'ready','mime_type':'application/pdf'})
        with patch('admin_assist_tools.render_attachment',side_effect=RuntimeError('PRIVATE_DEPENDENCY_LOG')):r=call_admin(p,'ler_anexo_autorizado',ARGS,TOKEN)
        self.assertEqual(r['structuredContent']['error_code'],'MCP_ADMIN_RENDER_UNAVAILABLE');self.assertNotIn('PRIVATE',json.dumps(r));self.assertEqual(len(calls),1)
if __name__=='__main__':unittest.main()
