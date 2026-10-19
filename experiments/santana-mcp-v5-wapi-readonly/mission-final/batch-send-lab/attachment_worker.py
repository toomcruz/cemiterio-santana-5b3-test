"""Bounded offline renderer. No tokens, URLs, scripts, forms or network access."""
import base64, hashlib, io, json, sys
try:
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (512*1024*1024, 512*1024*1024))
    resource.setrlimit(resource.RLIMIT_CPU, (8, 8))
except (ImportError, ValueError, OSError):
    pass

def analyze(b):
    raw=base64.b64decode(b['content_base64'],validate=True)
    if not 0<len(raw)<=2097152 or len(raw)!=b['size_bytes'] or hashlib.sha256(raw).hexdigest()!=b['sha256']:
        raise ValueError('ATTACHMENT_INTEGRITY')
    mime=b['mime_type'];start=b.get('page_start',1);limit=b.get('page_limit',2)
    if type(start) is not int or type(limit) is not int or not 1<=start<=100 or not 1<=limit<=2:raise ValueError('PAGE_RANGE')
    from PIL import Image
    Image.MAX_IMAGE_PIXELS=25000000
    def image_content(image):
        if image.width*image.height>25000000:raise ValueError('IMAGE_TOO_LARGE')
        image=image.convert('RGB');image.thumbnail((1280,1280))
        output=io.BytesIO();image.save(output,'JPEG',quality=80)
        if output.tell()>700000:raise ValueError('RENDER_TOO_LARGE')
        return base64.b64encode(output.getvalue()).decode()
    if mime in ('image/png','image/jpeg','image/webp'):
        with Image.open(io.BytesIO(raw)) as image:
            if Image.MIME.get(image.format)!=mime:raise ValueError('MIME_MISMATCH')
            return {'status':'ready','analysis_kind':'image','images':[{'page':1,'mime_type':'image/jpeg','data':image_content(image)}], 'original_sha256':b['sha256']}
    if mime!='application/pdf' or not raw.startswith(b'%PDF-'):raise ValueError('MIME_MISMATCH')
    import pypdfium2 as pdfium
    try:
        with pdfium.PdfDocument(raw) as doc:
            count=len(doc)
            if start>count:raise ValueError('PAGE_RANGE')
            images=[];pages=[]
            stop=min(start-1+limit,count,100)
            for index in range(start-1,stop):
                page=doc[index]
                try:
                    textpage=page.get_textpage()
                    try:text=textpage.get_text_range()
                    finally:textpage.close()
                    pages.append({'page':index+1,'text':text[:12000],'text_truncated':len(text)>12000})
                    width,height=page.get_size()
                    if width<=0 or height<=0:raise ValueError('PDF_DIMENSIONS')
                    bitmap=page.render(scale=min(2.0,1280/max(width,height)))
                    try:images.append({'page':index+1,'mime_type':'image/jpeg','data':image_content(bitmap.to_pil())})
                    finally:bitmap.close()
                finally:page.close()
            return {'status':'ready','analysis_kind':'pdf','page_count':count,'pages':pages,'images':images,'has_more_pages':stop<count,
                    'next_page_start':stop+1 if stop<count and stop<100 else None,'analysis_limit_reached':stop==100 and count>100,
                    'text_extracted':any(p['text'].strip() for p in pages),'original_sha256':b['sha256']}
    except pdfium.PdfiumError:
        raise ValueError('PDF_UNAVAILABLE_OR_PROTECTED') from None

if __name__=='__main__':
    try:
        content=sys.stdin.buffer.read(2900001)
        if len(content)>2900000:raise ValueError('ATTACHMENT_TOO_LARGE')
        result=analyze(json.loads(content))
    except Exception as error:
        code=str(error) if isinstance(error,ValueError) and str(error) in {'ATTACHMENT_INTEGRITY','PAGE_RANGE','IMAGE_TOO_LARGE','MIME_MISMATCH','PDF_UNAVAILABLE_OR_PROTECTED','RENDER_TOO_LARGE','ATTACHMENT_TOO_LARGE','PDF_DIMENSIONS'} else 'ATTACHMENT_ANALYSIS_UNAVAILABLE'
        result={'status':'analysis_unavailable','reason':code,'failure_type':type(error).__name__,'images':[]}
    print(json.dumps(result,ensure_ascii=False))
