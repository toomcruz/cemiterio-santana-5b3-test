"""Opt-in extension of the EXISTING v5 dispatcher/HTTP handler, fixture only."""
import json
from pathlib import Path
from http.cookies import SimpleCookie
from batch_send import Actor, Blocked, SOURCE

RESOURCE="ui://santana/lab-batch-review.html"
ROOT=Path(__file__).resolve().parent
TEXT={"type":"string","maxLength":3000}
SELECTOR={"type":"string","minLength":4,"maxLength":80}
ATTACHMENT={"type":"object","additionalProperties":False,"required":["name","mime_type","content_base64"],"properties":{
 "name":{"type":"string","maxLength":100},"mime_type":{"type":"string","enum":["image/png","image/jpeg","application/pdf"]},"content_base64":{"type":"string","maxLength":700000}}}
def tool(name,description,properties,required,write=False):
    return {"name":name,"description":"LAB fictício: "+description,"inputSchema":{"type":"object","properties":properties,"required":required,"additionalProperties":False},
            "annotations":{"readOnlyHint":not write,"destructiveHint":False,"openWorldHint":False},"_meta":{"ui":{"resourceUri":RESOURCE}}}
COMMON={"text":TEXT,"idempotency_key":{"type":"string","minLength":8,"maxLength":100},"attachment":ATTACHMENT}
TOOLS=[
 tool("preparar_envio_simplificado","Resolve um único contato autorizado por conversa, telefone ou final inequívoco. Prepara e mostra a prévia. Nunca aprova ou envia.",{"recipient":SELECTOR,**COMMON},["recipient","text","idempotency_key"],True),
 tool("preparar_lote","Prepara de 1 a 50 destinatários autorizados com prévia integral e revisão única do lote. Personalizações são vinculadas à conversa; não inventar regras pendentes.",{
  "recipients":{"type":"array","minItems":1,"maxItems":50,"items":SELECTOR},**COMMON,"personalized":{"type":"object","additionalProperties":TEXT},"purpose":{"type":"string","enum":["service","approved_notice"]}},["recipients","text","idempotency_key"],True),
 tool("consultar_lote","Consulta todas as operações, falhas e resultados desconhecidos. Não reenvia.",{"batch_id":{"type":"string","format":"uuid"}},["batch_id"]),
 tool("executar_lote_simulado","Executa no máximo UMA operação fictícia aprovada por chamada. Respeita o próximo horário retornado, sem repetir desconhecidos. Transporte real é impossível neste candidato.",{"batch_id":{"type":"string","format":"uuid"}},["batch_id"],True),
 tool("reconciliar_lote","Consulta recibos autoritativos fictícios e mantém desconhecidos bloqueados. Nunca tenta enviar.",{"batch_id":{"type":"string","format":"uuid"}},["batch_id"]),
]

def call(controller,actor,name,args):
    schema=next((t["inputSchema"] for t in TOOLS if t["name"]==name),None)
    if not schema or not isinstance(args,dict) or set(args)-set(schema["properties"]) or not set(schema["required"])<=set(args):
        raise Blocked("INVALID_TOOL_ARGUMENTS")
    if name=="preparar_envio_simplificado":
        return controller.prepare(actor,[args["recipient"]],args["text"],args["idempotency_key"],args.get("attachment"))
    if name=="preparar_lote":
        return controller.prepare(actor,args["recipients"],args["text"],args["idempotency_key"],args.get("attachment"),personalized=args.get("personalized"),purpose=args.get("purpose","service"))
    if name=="consultar_lote":
        return controller.status(actor,args["batch_id"])
    if name=="executar_lote_simulado":
        return controller.step(actor,args["batch_id"])
    return controller.reconcile(actor,args["batch_id"])

def install(server,controller,resolve_actor,base_url,real_review=None):
    """Mount in an isolated import of the v5 server; no file/service replacement."""
    if server.DATA_SOURCE!="fixture" or controller.directory.environment!=SOURCE or not base_url.startswith(("http://127.0.0.1:","https://")):
        raise Blocked("LAB_FIXTURE_MOUNT_ONLY")
    original=server.dispatch
    def dispatch(request,identity,access_token=None):
        if not isinstance(request,dict) or request.get('jsonrpc')!='2.0':
            raise server.MCPError(-32600,'Requisição JSON-RPC inválida.')
        client,role=identity
        method=request.get("method");params=request.get("params") or {};request_id=request.get("id")
        if not isinstance(params,dict):
            raise server.MCPError(-32602,'params deve ser um objeto.')
        if method in {"initialize","server/discover"}:
            response=original(request,identity,access_token)
            if client=="chatgpt" and response and 'result' in response:
                response['result'].setdefault('capabilities',{})['resources']={}
            return response
        if method=="tools/list":
            response=original(request,identity,access_token)
            if client=="chatgpt":
                response["result"]["tools"].extend(TOOLS)
                if real_review:
                    t=tool('registrar_revisao_lote','Registra somente um recibo de revisão humana já autenticada no HOMOLOG. Não recebe senha/JWT e não envia.',{'batch_id':{'type':'string','format':'uuid'},'receipt_id':{'type':'string','format':'uuid'}},['batch_id','receipt_id'],True)
                    t['_meta']['ui']['visibility']=['app']
                    response['result']['tools'].append(t)
            return response
        if method=="resources/list" and client=="chatgpt":
            return {"jsonrpc":"2.0","id":request_id,"result":{"resources":[{"uri":RESOURCE,"name":"Revisão de lote Santana LAB","mimeType":"text/html;profile=mcp-app"}]}}
        if method=="resources/read" and client=="chatgpt" and params.get("uri")==RESOURCE:
            domains=['https://xdccjulfqcqefykunwtg.supabase.co'] if real_review else []
            ui={'csp':{'connectDomains':domains,'resourceDomains':[]}}
            if real_review:
                ui['domain']='https://santana-mcp-homolog-consent.vercel.app'
                ui['csp']['frameDomains']=['https://santana-mcp-homolog-consent.vercel.app']
            return {"jsonrpc":"2.0","id":request_id,"result":{"contents":[{"uri":RESOURCE,"mimeType":"text/html;profile=mcp-app","text":(ROOT/("real-widget.html" if real_review else "widget.html")).read_text(),"_meta":{"ui":ui}}]}}
        if method=="tools/call" and params.get("name") in {t["name"] for t in TOOLS}|({'registrar_revisao_lote'} if real_review else set()):
            if client!="chatgpt":
                raise server.MCPError(-32003,"AGENT_SCOPE_DENIED")
            try:
                actor=resolve_actor(identity,access_token)
                args=params.get('arguments') or {}
                if params['name']=='registrar_revisao_lote':
                    if not isinstance(args,dict) or set(args)!={'batch_id','receipt_id'}:raise Blocked('INVALID_TOOL_ARGUMENTS')
                    value=real_review.register(actor,args['batch_id'],args['receipt_id'])
                else:value=call(controller,actor,params["name"],args)
                if "approval_url" in value:
                    value["approval_url"]=base_url+value["approval_url"]
                result={"content":[{"type":"text","text":json.dumps(value,ensure_ascii=False)}],"structuredContent":value}
                if real_review and 'batch_id' in value and 'preview' in value:
                    result['_meta']={'lab_review':real_review.metadata(actor,value['batch_id'])}
                return {"jsonrpc":"2.0","id":request_id,"result":result}
            except Blocked as error:
                return {"jsonrpc":"2.0","id":request_id,"result":{"isError":True,"content":[{"type":"text","text":str(error)}]}}
        return original(request,identity,access_token)
    server.dispatch=dispatch
    Base=server.Handler
    class Handler(Base):
        def do_GET(self):
            if self.path=="/lab/revisar-lote":
                b=(ROOT/"review.html").read_bytes()
                self.send_response(200)
                for k,v in {"Content-Type":"text/html; charset=utf-8","Content-Length":str(len(b)),"Cache-Control":"no-store","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-src blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}.items():
                    self.send_header(k,v)
                self.end_headers();self.wfile.write(b);return
            super().do_GET()

        def do_POST(self):
            if self.path!="/lab/review":
                super().do_POST();return
            if self.headers.get("Origin")!=base_url or self.headers.get("Sec-Fetch-Site")!="same-origin" or self.headers.get_content_type()!="application/json":
                self._json(403,{"error":"SAME_ORIGIN_REVIEW_REQUIRED"});return
            try:
                length=int(self.headers.get("Content-Length","0"))
                if not 1<=length<=3000:
                    raise Blocked("INVALID_REVIEW_BODY")
                b=json.loads(self.rfile.read(length));cookie=SimpleCookie(self.headers.get("Cookie",""))
                session=cookie.get("santana_lab_human")
                human=resolve_actor(("human",session.value if session else ""),None)
                if not isinstance(b,dict) or set(b)-{"action","batch_id","manifest_sha256","csrf_nonce","explicit"}:
                    raise Blocked("INVALID_REVIEW_BODY")
                if b.get("action")=="preview":
                    value=controller.review(human,b.get("batch_id"))
                elif b.get("action")=="approve":
                    value=controller.approve(human,b.get("batch_id"),b.get("manifest_sha256"),b.get("csrf_nonce"),b.get("explicit"))
                else:
                    raise Blocked("INVALID_REVIEW_ACTION")
                self._json(200,value)
            except (Blocked,ValueError,TypeError) as error:
                self._json(403,{"error":str(error) if isinstance(error,Blocked) else "INVALID_REVIEW_BODY"})
        def log_message(self,*args):
            return
    server.Handler=Handler
    return Handler
