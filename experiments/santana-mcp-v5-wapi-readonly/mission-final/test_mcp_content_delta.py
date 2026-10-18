import importlib.util, os, sys, unittest
from pathlib import Path
root=Path(__file__).parent/'mcp-deployment'/'whatsapp-santana-mcp'
sys.path.insert(0,str(root))
os.environ.update(SANTANA_DATA_SOURCE='sana_edge',SANTANA_AUTHORIZED_CONTENT_DEFAULT='true',SANTANA_AUDIT_DB=':memory:',SANA_READ_ENDPOINT='https://xdccjulfqcqefykunwtg.supabase.co/functions/v1/sana-mcp-read',CHATGPT_OAUTH_CLIENT_ID='ccb5e1fc-2a61-4296-943a-a85c103e9313',CHATGPT_WRITE_TOOLS='',OPENBOT_WRITE_TOOLS='',SANTANA_SEND_MODE='disabled')
import server
class Provider:
    def get_messages(self,*args,**kwargs):return {'include_content':args[2],'limit':args[1]}
class ContentDelta(unittest.TestCase):
    def test_catalog_preserves_explicit_content_choice_and_no_write_tools(self):
        d=server.dispatch({'jsonrpc':'2.0','id':1,'method':'tools/list'},('chatgpt','read'))
        tools={t['name']:t for t in d['result']['tools']}
        self.assertTrue(tools['consultar_mensagens']['inputSchema']['properties']['include_content']['default'])
        self.assertFalse(any(n.startswith('whatsapp_send') for n in tools))
        self.assertFalse(server.REAL_SEND_GATE_OPEN)
    def test_default_content_and_explicit_metadata(self):
        previous=server.PROVIDER;server.PROVIDER=Provider()
        try:
            d=server._read_dispatch('consultar_mensagens',{'conversation_id':'test'},'synthetic-token')
            self.assertEqual(d,{'include_content':True,'limit':20})
            self.assertFalse(server._read_dispatch('consultar_mensagens',{'conversation_id':'test','include_content':False},'synthetic-token')['include_content'])
        finally:server.PROVIDER=previous
if __name__=='__main__':unittest.main()
