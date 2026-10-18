"""Single official-channel request. No provider key, retries or alternate sender."""
import json,re
from urllib.request import Request,build_opener,HTTPRedirectHandler
from urllib.error import HTTPError
ENDPOINT='https://atendimento-cemiterio-santana.vercel.app/api/runtime/sana-control'
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
def send_prepared(operation_id,payload_sha256,access_token):
    if not re.fullmatch(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}',str(operation_id)) or not re.fullmatch(r'[0-9a-f]{64}',str(payload_sha256)):
        raise ValueError('Operação ou hash inválido.')
    if not isinstance(access_token,str) or not re.fullmatch(r'[A-Za-z0-9._~-]{20,16384}',access_token):
        raise PermissionError('Sessão OAuth individual necessária.')
    req=Request(ENDPOINT,method='POST',headers={'Authorization':'Bearer '+access_token,'Content-Type':'application/json'},data=json.dumps({'action':'mcp_send','operation_id':operation_id,'payload_sha256':payload_sha256}).encode())
    try:
        try:response=build_opener(NoRedirect).open(req,timeout=45)
        except HTTPError as error:response=error
        with response:
            raw=response.read(12001)
            if len(raw)>12000:raise ValueError()
            result=json.loads(raw)
            if not isinstance(result,dict):raise ValueError()
            if response.status>=400:
                return {'status':'blocked','error':result.get('error','OFFICIAL_CHANNEL_UNAVAILABLE'),'operation_id':operation_id,'retry_allowed':False,'delivery_confirmed':False}
            if result.get('operation_id')!=operation_id or result.get('status')!='recorded' or result.get('delivery_state') not in {'sent','failed','unknown','test','dispatching'}:
                raise ValueError()
            return {'status':'recorded','operation_id':operation_id,'delivery_state':result['delivery_state'],'accepted_by_api':result['delivery_state']=='sent','delivery_confirmed':False,'retry_allowed':False}
    except Exception:
        return {'status':'outcome_unknown','operation_id':operation_id,'retry_allowed':False,'delivery_confirmed':False}
