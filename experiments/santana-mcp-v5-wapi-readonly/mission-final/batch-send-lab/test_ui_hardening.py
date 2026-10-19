import base64, hashlib, importlib.util, json, re, sys, unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
from review_assets import protected_html,AUTH_ORIGIN
from review_media import ReviewMedia
from real_review import RealReview
from test_real_review import RealReviewTests
from mcp_extension import install,RESOURCE

class UIHardeningTests(unittest.TestCase):
    def test_protocol_result_has_no_invalid_link_and_resource_csp_is_scoped(self):
        case=RealReviewTests();case.setUp();self.addCleanup(case.doCleanups)
        server=SimpleNamespace(DATA_SOURCE='fixture',Handler=type('Handler',(),{}),
            dispatch=lambda req,identity,token=None:{'jsonrpc':'2.0','id':req.get('id'),'result':{'tools':[]}})
        install(server,case.e,lambda *a:case.client,'https://chatgpt.com',case.review)
        b=case.prepare()
        r=server.dispatch({'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'consultar_lote','arguments':{'batch_id':b['batch_id']}}},('chatgpt','read'))['result']
        self.assertNotIn('approval_url',r['structuredContent']);self.assertNotIn('chatgpt.com/lab/revisar-lote',r['content'][0]['text'])
        self.assertEqual(r['structuredContent']['review_interface'],'chatgpt_component')
        resource=server.dispatch({'jsonrpc':'2.0','id':2,'method':'resources/read','params':{'uri':RESOURCE}},('chatgpt','read'))['result']['contents'][0]
        self.assertEqual(resource['_meta']['ui']['csp']['connectDomains'],[AUTH_ORIGIN])
        self.assertNotIn('frameDomains',resource['_meta']['ui']['csp'])
        self.assertEqual(resource['_meta']['openai/widgetCSP']['connect_domains'],[AUTH_ORIGIN])
    def test_csp_pins_exact_script_and_style_and_no_external_assets(self):
        html=(ROOT/'real-widget.html').read_text();secured=protected_html(html)
        for tag in ('script','style'):
            body=re.search('<'+tag+'>([\\s\\S]*?)</'+tag+'>',html)[1]
            sha=base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
            self.assertIn("'sha256-"+sha+"'",secured)
        self.assertIn('connect-src '+AUTH_ORIGIN,secured)
        self.assertIn("frame-src 'none'",secured)
        self.assertNotIn('unsafe-inline',secured)
        self.assertNotIn('<iframe',secured)

    def test_changed_template_fails_closed(self):
        for h in ('<html></html>','<meta charset="utf-8"><script>a</script><script>b</script><style>a</style>'):
            with self.assertRaises(ValueError):protected_html(h)

    def pdf(self):
        return json.loads((ROOT.parent/'supervised-send/media-fixtures/fixtures.json').read_text())['Santana-Teste-Documento.pdf']

    def test_real_offline_pdf_renderer_returns_complete_page_and_integrity(self):
        media=self.pdf();value=ReviewMedia().render_pdf(media)
        self.assertEqual(value['status'],'ready',value);self.assertTrue(value['complete'])
        self.assertEqual(value['original_sha256'],media['sha256']);self.assertEqual(value['page_count'],1)
        for page in value['images']:
            raw=base64.b64decode(page['content_base64']);self.assertEqual(hashlib.sha256(raw).hexdigest(),page['sha256'])

    def test_unreadable_pdf_never_gets_complete_preview(self):
        media=self.pdf();media['content_base64']=base64.b64encode(b'%PDF-invalid-document').decode()
        media['size_bytes']=len(b'%PDF-invalid-document');media['sha256']=hashlib.sha256(b'%PDF-invalid-document').hexdigest()
        value=ReviewMedia().render_pdf(media);self.assertFalse(value['complete']);self.assertEqual(value['images'],[])

    def test_cached_render_does_not_repeat_decoder_and_cache_is_bounded(self):
        renderer=ReviewMedia()
        with patch.object(renderer,'_render',return_value={'status':'ready'}) as render:
            renderer.render_pdf({'sha256':'a'});renderer.render_pdf({'sha256':'a'})
            self.assertEqual(render.call_count,1)
            for k in ('b','c','d','e'):renderer.render_pdf({'sha256':k})
            self.assertEqual(len(renderer.cache),4);self.assertNotIn('a',renderer.cache)

    def test_pdf_rendering_occurs_outside_sqlite_transaction(self):
        case=RealReviewTests();case.setUp();self.addCleanup(case.doCleanups)
        b=case.prepare()
        original=case.e.hydrate_media
        # Use real fixture PDF through the controller rather than custom metadata.
        f=self.pdf();f['name']='synthetic.pdf'
        batch=case.e.prepare(case.client,case.base.ids[:2],'PDF fictício','hardening-pdf-test',attachment={k:f[k] for k in ('name','mime_type','content_base64')})
        def render(m):
            self.assertFalse(case.e.db.in_transaction)
            return {'status':'preview_unavailable','complete':False,'images':[]}
        with patch.object(case.review.media_renderer,'render_pdf',side_effect=render):
            meta=case.review.metadata(case.client,batch['batch_id'])
        self.assertFalse(meta['pdf_previews'][f['sha256']]['complete'])
        self.assertEqual(meta['batch_state'],'prepared')

if __name__=='__main__':unittest.main()
