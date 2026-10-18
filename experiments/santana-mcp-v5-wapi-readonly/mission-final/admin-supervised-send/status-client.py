"""Read-only status on the existing official channel; never dispatches."""
def consult_official_status(operation_id,access_token):
    import json,re
    from urllib.request import Request,build_opener
    from urllib.error import HTTPError
    from official_send_provider import NoRedirect,ENDPOINT
    if not re.fullmatch(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}',str(operation_id)) or not isinstance(access_token,str) or not re.fullmatch(r'[A-Za-z0-9._~-]{20,16384}',access_token):
        raise ValueError('Operação ou sessão inválida.')
    request=Request(ENDPOINT,method='POST',headers={'Authorization':'Bearer '+access_token,'Content-Type':'application/json'},data=json.dumps({'action':'mcp_status','operation_id':operation_id}).encode())
    try:
        try:response=build_opener(NoRedirect).open(request,timeout=15)
        except HTTPError as error:response=error
        with response:
            raw=response.read(12001)
            if len(raw)>12000:raise ValueError()
            value=json.loads(raw)
            if response.status!=200 or value.get('operation_id')!=operation_id or value.get('state') not in {'authorized','dispatching','sent','failed','unknown','test'}:
                error=value.get('error','MCP_STATUS_UNAVAILABLE')
                return {'status':'unavailable','error':error if isinstance(error,str) and re.fullmatch(r'MCP_[A-Z_]+',error) else 'MCP_STATUS_UNAVAILABLE','no_send':True}
            return {'status':'ready','state':value['state'],'operation_id':operation_id,'accepted_by_api':value['state']=='sent','delivery_confirmed':False,'retry_send_allowed':False,'no_send':True}
    except Exception:
        return {'status':'unavailable','error':'MCP_STATUS_UNAVAILABLE','no_send':True}
