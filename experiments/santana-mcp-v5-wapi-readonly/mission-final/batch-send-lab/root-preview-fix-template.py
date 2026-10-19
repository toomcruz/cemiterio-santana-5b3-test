"""Atomically update one LAB HTML resource; no restart or database write."""
def protected(html,target):
    import runpy
    assets=target/'review_assets.py'
    if assets.is_symlink() or hashlib.sha256(assets.read_bytes()).hexdigest()!=ASSETS_SHA:
        raise RuntimeError('LAB_CSP_HELPER_DRIFT')
    return runpy.run_path(str(assets))['protected_html'](html)

def verify_resource(env,expected):
    body=json.dumps({'jsonrpc':'2.0','id':1,'method':'resources/read','params':{'uri':'ui://santana/lab-batch-review.html'}}).encode()
    req=Request(LAB_URL,data=body,headers={'Authorization':'Bearer '+env['CHATGPT_READ_TOKEN'],'Content-Type':'application/json','Accept':'application/json, text/event-stream'})
    with build_opener(ProxyHandler({})).open(req,timeout=5) as r:value=json.load(r)['result']['contents'][0]
    if value['text']!=expected:raise RuntimeError('LIVE_PREVIEW_RESOURCE_NOT_PROVEN')

def main():
    if os.geteuid()!=0:raise SystemExit('ROOT_REQUIRED_NO_CHANGE')
    report={'whatsapp_sends':0,'production_changes':0,'permissions_changed':False,'auth_grants_changed':False,'services_restarted':0}
    changed=False;backup=None;phase='preflight'
    try:
        if command(['hostname']).split('.')[0]!='srv1849463':raise RuntimeError('WRONG_HOST')
        base=Path(property('WorkingDirectory'));target=base/'santana_batch_lab';path=target/'real-widget.html'
        if str(base)!=BASE_PATH or base.is_symlink() or target.is_symlink() or path.is_symlink():raise RuntimeError('LAB_PATH_CHANGED')
        if hashlib.sha256((base/'server.py').read_bytes()).hexdigest()!=EXPECTED_SERVER:raise RuntimeError('LAB_CODE_DRIFT')
        env=process_env(property('MainPID'));require_configuration(env);names=catalog(env)
        digest=hashlib.sha256(path.read_bytes()).hexdigest()
        if hashlib.sha256(PATCHED_HTML.encode()).hexdigest()!=NEW_SHA or 'URL.createObjectURL(' in PATCHED_HTML or "el.src='data:'+file.mime_type+';base64,'+file.content_base64" not in PATCHED_HTML:
            raise RuntimeError('PATCH_INTEGRITY_MISMATCH')
        secured=protected(PATCHED_HTML,target)
        if digest==NEW_SHA:
            verify_resource(env,secured);report.update(status='LAB_PREVIEW_COMPAT_ALREADY_FIXED',source='fixture',real_send_enabled=False);emit(report);return
        if digest!=OLD_SHA:raise RuntimeError('LAB_WIDGET_CODE_DRIFT')
        original=path.read_text();protected_original=protected(original,target)
        backup=BACKUP_PATH/('preview-compat-'+time.strftime('%Y%m%dT%H%M%SZ')+'-'+str(time.time_ns()));backup.mkdir(mode=0o700,parents=True)
        shutil.copy2(path,backup/'real-widget.original.html');report['backup']=str(backup)
        pid_before=property('MainPID');tunnel_before=property('MainPID','santana-mcp-lab-tunnel.service')
        phase='replace_one_html_resource'
        tmp=target/('.preview-compat-'+str(time.time_ns())+'.tmp');tmp.write_text(PATCHED_HTML);tmp.chmod(0o600);os.replace(tmp,path);changed=True
        phase='verify_live_resource';verify_resource(env,secured)
        if property('MainPID')!=pid_before or property('MainPID','santana-mcp-lab-tunnel.service')!=tunnel_before:raise RuntimeError('UNEXPECTED_SERVICE_PID_CHANGE')
        report.update(status='LAB_PREVIEW_COMPAT_FIXED',source='fixture',real_send_enabled=False,tools=names,
            lab_pid=pid_before,lab_pid_unchanged=True,lab_tunnel_pid_unchanged=True,only_file='real-widget.html',
            image_source='verified_data_uri',per_component_csp=True,external_review_link=False)
        emit(report)
    except BaseException as error:
        report.update(status='LAB_PREVIEW_FIX_STOPPED_NO_CHANGE',phase=phase,**safe_error(error))
        if changed:
            try:
                tmp=target/('.preview-restore-'+str(time.time_ns())+'.tmp');shutil.copy2(backup/'real-widget.original.html',tmp);os.replace(tmp,path)
                verify_resource(env,protected_original)
                report.update(status='LAB_PREVIEW_FIX_FAILED_RESTORED',lab_restored=True)
            except BaseException as restore_error:report.update(status='LAB_PREVIEW_RESTORE_NOT_PROVEN',restore_error=safe_error(restore_error))
        emit(report);raise SystemExit(1) from None

if __name__=='__main__':main()
