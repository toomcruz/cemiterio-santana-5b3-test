import base64,hashlib,importlib.util,io,json,os,sys,sysconfig,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent
CANDIDATE=ROOT/'candidate/homolog-mcp/whatsapp-santana-mcp'
sys.path[:0]=[str(CANDIDATE),str(ROOT.parent/'mcp-deployment/whatsapp-santana-mcp')]
os.environ.update(SANTANA_DATA_SOURCE='sana_edge',SANTANA_AUDIT_DB=':memory:',SANA_READ_ENDPOINT='https://xdccjulfqcqefykunwtg.supabase.co/functions/v1/sana-mcp-read',CHATGPT_OAUTH_CLIENT_ID='ccb5e1fc-2a61-4296-943a-a85c103e9313',SANTANA_SEND_MODE='disabled',SANTANA_PREPARATION_ENABLED='true',SANTANA_SUPERVISED_SEND_VERIFIED='true',CHATGPT_WRITE_TOOLS='',OPENBOT_WRITE_TOOLS='')
from admin_assist_tools import MODES,render_attachment
def server(enabled=True):
    with patch.dict(os.environ,SANTANA_ADMIN_ASSIST_ENABLED='true' if enabled else 'false'):
        spec=importlib.util.spec_from_file_location('isolated_admin_mcp',CANDIDATE/'server.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def fixture(name):
    value=json.loads((ROOT.parent/'supervised-send/media-fixtures/fixtures.json').read_text())[name]
    data=base64.b64decode(value['content_base64'],validate=True)
    assert hashlib.sha256(data).hexdigest()==value['sha256'] and len(data)==value['size_bytes']
    return data
def payload(data,mime):return {'status':'ready','conversation_id':'20000000-0000-4000-8000-000000000001','artifact_id':'synthetic','mime_type':mime,'size_bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'content_base64':base64.b64encode(data).decode()}
def message(name,args):return {'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':name,'arguments':args}}
class AdminMCP(unittest.TestCase):
    def test_catalog_is_additive_default_off_and_never_exposes_admin_to_openbot(self):
        for enabled in (False,True):
            m=server(enabled)
            for client in ('chatgpt','openbot'):
                names={t['name'] for t in m.dispatch({'jsonrpc':'2.0','id':1,'method':'tools/list'},(client,'read'))['result']['tools']}
                self.assertEqual(set(MODES)<=names,enabled and client=='chatgpt')
                if client=='chatgpt':self.assertEqual(len(names),13 if enabled else 9)
                self.assertFalse(m.REAL_SEND_GATE_OPEN)
    def test_each_new_tool_forwards_only_its_read_mode_and_original_oauth(self):
        m=server();cid='20000000-0000-4000-8000-000000000001'
        for name,args in [('listar_pendencias',{}),('consultar_contexto_atendimento',{'conversation_id':cid}),('consultar_regras_santana',{'query':'synthetic'})]:
            with patch.object(m.PROVIDER,'_call',return_value={'status':'ready','send_allowed':False}) as call:
                r=m.dispatch(message(name,args),('chatgpt','read'),'synthetic-oauth-only')
                call.assert_called_once_with({'mode':MODES[name],**args},'synthetic-oauth-only');self.assertFalse(r['result']['structuredContent']['send_allowed'])
    def test_no_global_credentials_or_untrusted_operator_override(self):
        m=server()
        for client,args in [('openbot',{}),('chatgpt',{'operator_id':'forged'})]:
            with patch.object(m.PROVIDER,'_call') as call:
                with self.assertRaises(m.MCPError):m.dispatch(message('listar_pendencias',args),(client,'read'),'synthetic')
                call.assert_not_called()
    def test_revoked_oauth_reports_authentication_error_without_retry(self):
        m=server()
        with patch.object(m.PROVIDER,'_call',side_effect=m.OAuthAuthenticationError('synthetic-session-expired')) as call:
            with self.assertRaises(m.MCPError) as caught:m.dispatch(message('listar_pendencias',{}),('chatgpt','read'),'synthetic')
            self.assertEqual(caught.exception.code,-32001);self.assertEqual(call.call_count,1)
    def test_received_image_is_returned_as_image_content_without_provider_urls_or_keys(self):
        r=render_attachment(payload(fixture('Santana-Teste-Imagem.png'),'image/png'),{})
        self.assertEqual(r['structuredContent']['status'],'ready',r['structuredContent']);self.assertEqual(r['content'][1]['type'],'image');self.assertNotIn('content_base64',r['structuredContent']);self.assertFalse(r['structuredContent']['document_validation_granted'])
    def test_real_pdf_engine_extracts_text_and_renders_page(self):
        r=render_attachment(payload(fixture('Santana-Teste-Documento.pdf'),'application/pdf'),{})
        self.assertEqual(r['structuredContent']['status'],'ready',r['structuredContent']);self.assertTrue(r['structuredContent']['text_extracted']);self.assertEqual(r['structuredContent']['page_count'],1);self.assertEqual(r['content'][1]['type'],'image')
    def test_scanned_pdf_is_visually_available_even_without_text_layer(self):
        from PIL import Image,ImageDraw
        image=Image.new('RGB',(450,300),'white');ImageDraw.Draw(image).text((20,20),'SYNTHETIC SCANNED DOCUMENT',fill='black');out=io.BytesIO();image.save(out,format='PDF')
        r=render_attachment(payload(out.getvalue(),'application/pdf'),{})
        self.assertEqual(r['structuredContent']['status'],'ready',r['structuredContent']);self.assertFalse(r['structuredContent']['text_extracted']);self.assertEqual(r['content'][1]['type'],'image')
    def test_multipage_pdf_is_paginated_and_does_not_claim_complete_analysis(self):
        import pypdfium2 as pdfium
        doc=pdfium.PdfDocument.new()
        for _ in range(3):doc.new_page(200,200)
        out=io.BytesIO();doc.save(out);doc.close()
        first=render_attachment(payload(out.getvalue(),'application/pdf'),{'page_limit':2});self.assertTrue(first['structuredContent']['has_more_pages']);self.assertEqual(first['structuredContent']['next_page_start'],3)
        last=render_attachment(payload(out.getvalue(),'application/pdf'),{'page_start':3});self.assertFalse(last['structuredContent']['has_more_pages'])
    def test_corrupt_pdf_invalid_mime_and_hash_mismatch_are_explicit_failures(self):
        for data in [payload(b'not a PDF','application/pdf'),payload(b'%PDF-1.7 broken','application/pdf'),{**payload(b'abc','image/png'),'sha256':'a'*64}]:
            r=render_attachment(data,{});self.assertTrue(r['isError']);self.assertEqual(r['structuredContent']['status'],'analysis_unavailable');self.assertEqual(len(r['content']),1)
    def test_worker_never_receives_auth_or_provider_metadata(self):
        with patch('admin_assist_tools.subprocess.run') as run:
            run.return_value.returncode=0;run.return_value.stdout=json.dumps({'status':'ready','images':[]})
            result=render_attachment({**payload(b'abc','image/png'),'token':'MUST_NOT_REACH_RENDERER','provider':{'mediaKey':'MUST_NOT_REACH_RENDERER'}},{})
            kwargs=run.call_args.kwargs;self.assertNotIn('MUST_NOT_REACH_RENDERER',kwargs['input']);self.assertLessEqual(set(kwargs['env']),{'PATH','LD_LIBRARY_PATH'});self.assertEqual(kwargs['timeout'],10)
            if 'LD_LIBRARY_PATH' in kwargs['env']:
                expected={str(p.resolve()) for p in (Path(sys.base_prefix)/'lib',Path(sysconfig.get_config_var('LIBDIR'))) if p.is_absolute() and p.is_dir()}
                self.assertEqual(set(kwargs['env']['LD_LIBRARY_PATH'].split(os.pathsep)),expected)
            self.assertNotIn('MUST_NOT_REACH_RENDERER',json.dumps(result))
if __name__=='__main__':unittest.main()
