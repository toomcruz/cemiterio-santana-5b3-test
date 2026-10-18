import importlib.util,os,sys,unittest
from pathlib import Path
from unittest.mock import patch
base=Path(__file__).parent
sys.path.insert(0,str(base.parent/'mcp-deployment'/'whatsapp-santana-mcp'));sys.path.insert(0,str(base))
os.environ.update(SANTANA_DATA_SOURCE='sana_edge',SANTANA_AUDIT_DB=':memory:',SANA_READ_ENDPOINT='https://xdccjulfqcqefykunwtg.supabase.co/functions/v1/sana-mcp-read',CHATGPT_OAUTH_CLIENT_ID='ccb5e1fc-2a61-4296-943a-a85c103e9313',SANTANA_SEND_MODE='disabled',CHATGPT_WRITE_TOOLS='',OPENBOT_WRITE_TOOLS='')
def load(enabled):
    with patch.dict(os.environ,SANTANA_SUPERVISED_SEND_VERIFIED='true' if enabled else 'false'):
        spec=importlib.util.spec_from_file_location('candidate_mcp',base/'mcp-server.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
class Gates(unittest.TestCase):
    def test_default_off_and_independent_openbot_denial(self):
        for enabled in (False,True):
            m=load(enabled)
            for client in ('chatgpt','openbot'):
                tools=m.dispatch({'jsonrpc':'2.0','id':1,'method':'tools/list'},(client,'read'))['result']['tools']
                self.assertEqual('enviar_envio_preparado' in {x['name'] for x in tools},enabled and client=='chatgpt')
                self.assertFalse(m.REAL_SEND_GATE_OPEN)
    def test_only_exact_operation_and_hash_are_forwarded_once(self):
        m=load(True);args={'operation_id':'10000000-0000-4000-8000-000000000001','payload_sha256':'a'*64}
        with patch('official_send_provider.send_prepared',return_value={'status':'synthetic'}) as send:
            m.dispatch({'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'enviar_envio_preparado','arguments':args}},('chatgpt','read'),'synthetic-oauth-token-only')
            send.assert_called_once_with(args['operation_id'],args['payload_sha256'],'synthetic-oauth-token-only')
            with self.assertRaises(m.MCPError):m.dispatch({'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':'enviar_envio_preparado','arguments':{**args,'phone':'forbidden'}}},('chatgpt','read'),'synthetic-oauth-token-only')
if __name__=='__main__':unittest.main()
