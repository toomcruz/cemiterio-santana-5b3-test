import importlib.util,io,json,os,sys,unittest
from pathlib import Path
from unittest.mock import patch
R=Path(__file__).resolve().parent
sys.path[:0]=[str(R/'candidate/mcp'),str(R.parent/'admin-supervised-send/deployment-delta/mcp/whatsapp-santana-mcp'),str(R.parent/'mcp-deployment/whatsapp-santana-mcp')]
from panel_review_provider import panel_review
OP='10000000-0000-4000-8000-000000000005';TOKEN='synthetic-oauth-token-only'
class Response(io.BytesIO):status=200
class MCP(unittest.TestCase):
 def test_status_unknown_is_read_only_and_never_retried(self):
  with patch('panel_review_provider.build_opener') as o:
   o.return_value.open.return_value=Response(json.dumps({'operation_id':OP,'state':'unknown','accepted_by_api':None}).encode())
   r=panel_review('status',OP,TOKEN);self.assertIsNone(r['accepted_by_api']);self.assertFalse(r['retry_allowed']);self.assertTrue(r['no_send']);self.assertEqual(o.return_value.open.call_count,1);self.assertEqual(json.loads(o.return_value.open.call_args.args[0].data)['action'],'mcp_review_status')
 def test_stage_only_accepts_the_bound_panel_url(self):
  for url,ok in [('https://atendimento-cemiterio-santana.vercel.app/mcp-review?operation='+OP,True),('https://evil.invalid',False)]:
   with patch('panel_review_provider.build_opener') as o:
    o.return_value.open.return_value=Response(json.dumps({'operation_id':OP,'state':'prepared','review_url':url}).encode());self.assertEqual(panel_review('stage',OP,TOKEN,'a'*64)['status'],'ready' if ok else 'unavailable')
 def test_network_failure_does_not_send_retry_or_report_success(self):
  with patch('panel_review_provider.build_opener') as o:
   o.return_value.open.side_effect=TimeoutError();self.assertEqual(panel_review('stage',OP,TOKEN,'a'*64)['status'],'unavailable');self.assertEqual(o.return_value.open.call_count,1)
 def test_approval_or_dispatch_actions_are_not_callable_by_mcp_provider(self):
  for a in ['approve','approve_send','send','settle']:self.assertRaises(ValueError,panel_review,a,OP,TOKEN)
 @classmethod
 def setUpClass(cls):
  with patch.dict(os.environ,SANTANA_DATA_SOURCE='sana_edge',SANTANA_PREPARATION_ENABLED='true',SANTANA_AUDIT_DB=':memory:',SANA_READ_ENDPOINT='https://xdccjulfqcqefykunwtg.supabase.co/functions/v1/sana-mcp-read',CHATGPT_OAUTH_CLIENT_ID='ccb5e1fc-2a61-4296-943a-a85c103e9313'):
   spec=importlib.util.spec_from_file_location('single_review_mcp',R/'candidate/mcp/server.py');cls.server=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.server)
 def tool(self,name,args):return self.server.dispatch({'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':name,'arguments':args}},('chatgpt','read'),TOKEN)['result']['structuredContent']
 def test_preparation_returns_one_panel_page_without_homolog_human_link(self):
  context={'status':'ready','conversation':{'conversation_id':OP,'revision':1,'message_watermark':{'inbox':None,'sana':None}}}
  draft={'status':'ready','intent_id':OP,'payload_sha256':'b'*64,'payload':{'expected_revision':1,'conversation_watermark':{'inbox':None,'sana':None}},'approval_url':'https://homolog.invalid'}
  with patch.object(self.server.PROVIDER,'_call',side_effect=[context,draft]),patch('panel_review_provider.panel_review',return_value={'status':'ready','review_url':'https://atendimento-cemiterio-santana.vercel.app/mcp-review?operation='+OP}) as p,patch('official_send_provider.send_prepared') as send:
   r=self.tool('preparar_envio',{'conversation_id':OP,'idempotency_key':OP,'text':'Fictício'});self.assertTrue(r['review_ready']);self.assertIn('/mcp-review?',r['approval_url']);p.assert_called_once_with('stage',OP,TOKEN,'b'*64);send.assert_not_called()
 def test_changed_context_during_preparation_does_not_release_a_review(self):
  context={'status':'ready','conversation':{'conversation_id':OP,'revision':1,'message_watermark':{'inbox':None,'sana':None}}}
  with patch.object(self.server.PROVIDER,'_call',side_effect=[context,{'status':'ready','payload':{'expected_revision':2}}]),patch('panel_review_provider.panel_review') as p:
   with self.assertRaises(self.server.MCPError):self.tool('preparar_envio',{'conversation_id':OP,'idempotency_key':OP,'text':'Fictício'})
   p.assert_not_called()
 def test_context_permission_failure_cannot_prepare_or_release_a_review(self):
  with patch.object(self.server.PROVIDER,'_call',return_value={'status':'denied'}) as read,patch('panel_review_provider.panel_review') as p:
   with self.assertRaises(self.server.MCPError):self.tool('preparar_envio',{'conversation_id':OP,'idempotency_key':OP,'text':'Fictício'})
   self.assertEqual(read.call_count,1);p.assert_not_called()
 def test_consult_reads_new_official_status_without_homolog_fallback_on_timeout(self):
  with patch('panel_review_provider.panel_review',return_value={'status':'unavailable','error':'MCP_PANEL_STATUS_UNAVAILABLE'}),patch.object(self.server.PROVIDER,'_call') as old,patch('official_send_provider.send_prepared') as send:
   r=self.tool('consultar_envio_preparado',{'intent_id':OP});self.assertEqual(r['status'],'unavailable');old.assert_not_called();send.assert_not_called()
 def test_old_operation_not_found_keeps_existing_official_path(self):
  with patch('panel_review_provider.panel_review',return_value={'status':'unavailable','error':'MCP_PANEL_DRAFT_NOT_AVAILABLE'}),patch.object(self.server.PROVIDER,'_call',return_value={'status':'ready'}) as old,patch('official_send_provider.consult_official_status',return_value={'state':'sent'}) as status:
   self.assertEqual(self.tool('consultar_envio_preparado',{'intent_id':OP})['official_status']['state'],'sent');old.assert_called_once();status.assert_called_once()
if __name__=='__main__':unittest.main()
