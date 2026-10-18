import importlib.util,io,json,os,sys,unittest
from pathlib import Path
from unittest.mock import patch
R=Path(__file__).resolve().parent;sys.path.insert(0,str(R/'candidate'))
from official_send_provider import consult_official_status
class Response(io.BytesIO):
    status=200
class Status(unittest.TestCase):
    def test_mcp_status_tool_consults_official_record_without_dispatch(self):
        sys.path[:0]=[str(R.parent/'admin-assist/candidate/homolog-mcp/whatsapp-santana-mcp'),str(R.parent/'mcp-deployment/whatsapp-santana-mcp')]
        with patch.dict(os.environ,SANTANA_DATA_SOURCE='sana_edge',SANTANA_PREPARATION_ENABLED='true',SANTANA_AUDIT_DB=':memory:',SANA_READ_ENDPOINT='https://xdccjulfqcqefykunwtg.supabase.co/functions/v1/sana-mcp-read',CHATGPT_OAUTH_CLIENT_ID='ccb5e1fc-2a61-4296-943a-a85c103e9313'):
            spec=importlib.util.spec_from_file_location('scoped_status_mcp',R/'candidate/server.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
            with patch.object(m.PROVIDER,'_call',return_value={'status':'ready','state':'human_reviewed_dispatch_blocked'}),patch('official_send_provider.consult_official_status',return_value={'status':'ready','state':'unknown'}) as status,patch('official_send_provider.send_prepared') as send:
                op='10000000-0000-4000-8000-000000000005';r=m.dispatch({'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'consultar_envio_preparado','arguments':{'intent_id':op}}},('chatgpt','read'),'synthetic-oauth-token-only')
                self.assertEqual(r['result']['structuredContent']['official_status']['state'],'unknown');status.assert_called_once_with(op,'synthetic-oauth-token-only');send.assert_not_called()
    def test_unknown_result_is_read_without_claim_or_transport_and_never_allows_resend(self):
        op='10000000-0000-4000-8000-000000000005'
        with patch('urllib.request.build_opener') as opener:
            opener.return_value.open.return_value=Response(json.dumps({'state':'unknown','operation_id':op}).encode())
            result=consult_official_status(op,'synthetic-oauth-token-only')
            request=opener.return_value.open.call_args.args[0]
            self.assertEqual(json.loads(request.data),{'action':'mcp_status','operation_id':op});self.assertEqual(result['state'],'unknown');self.assertFalse(result['retry_send_allowed']);self.assertTrue(result['no_send']);self.assertEqual(opener.return_value.open.call_count,1)
    def test_ambiguous_status_query_is_not_reported_as_sent_and_is_not_retried(self):
        with patch('urllib.request.build_opener') as opener:
            opener.return_value.open.side_effect=TimeoutError()
            result=consult_official_status('10000000-0000-4000-8000-000000000005','synthetic-oauth-token-only')
            self.assertEqual(result['status'],'unavailable');self.assertTrue(result['no_send']);self.assertEqual(opener.return_value.open.call_count,1)
if __name__=='__main__':unittest.main()
