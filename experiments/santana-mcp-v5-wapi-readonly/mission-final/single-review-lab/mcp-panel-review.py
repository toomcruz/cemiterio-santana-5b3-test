"""Stages a draft or reads its receipt. Cannot approve, send or retry a message."""
import json,re
from urllib.request import Request,build_opener
from urllib.error import HTTPError
from official_send_provider import ENDPOINT,NoRedirect
UUID=r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}'
def panel_review(action,operation_id,token,payload_sha256=None):
    if action not in {'stage','status'} or not re.fullmatch(UUID,str(operation_id)) or not isinstance(token,str) or not re.fullmatch(r'[A-Za-z0-9._~-]{20,16384}',token):raise ValueError('Operação ou sessão inválida.')
    if action=='stage' and not re.fullmatch(r'[a-f0-9]{64}',str(payload_sha256)):raise ValueError('Hash inválido.')
    body={'action':'mcp_review_'+action,'operation_id':operation_id}
    if action=='stage':body['payload_sha256']=payload_sha256
    request=Request(ENDPOINT,method='POST',headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},data=json.dumps(body).encode())
    try:
        try:response=build_opener(NoRedirect).open(request,timeout=25)
        except HTTPError as error:response=error
        with response:
            raw=response.read(64001)
            if len(raw)>64000:raise ValueError()
            value=json.loads(raw)
            if not isinstance(value,dict):raise ValueError()
            if response.status>=400:
                error=value.get('error','MCP_PANEL_STATUS_UNAVAILABLE')
                return {'status':'unavailable','error':error if isinstance(error,str) and re.fullmatch(r'MCP_[A-Z_]+',error) else 'MCP_PANEL_STATUS_UNAVAILABLE','no_send':True}
            if value.get('operation_id')!=operation_id or value.get('state') not in {'prepared','authorized','dispatching','sent','failed','unknown','test'}:raise ValueError()
            result={'status':'ready','operation_id':operation_id,'state':value['state'],'payload':value.get('payload'),'payload_sha256':value.get('payload_sha256'),'approved':value.get('approved') is True,'accepted_by_api':value.get('accepted_by_api'),'delivery_confirmed':value.get('delivery_confirmed') is True,'retry_allowed':False,'no_send':True}
            if action=='stage':
                expected='https://atendimento-cemiterio-santana.vercel.app/mcp-review?operation='+operation_id
                if value.get('review_url')!=expected:raise ValueError()
                result['review_url']=expected
            return result
    except Exception:return {'status':'unavailable','error':'MCP_PANEL_STATUS_UNAVAILABLE','no_send':True}
