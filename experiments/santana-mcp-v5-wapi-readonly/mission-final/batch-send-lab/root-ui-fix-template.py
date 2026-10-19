"""Change one UI descriptor field in the already installed LAB extension."""
def main():
    if os.geteuid()!=0:raise SystemExit('ROOT_REQUIRED_NO_CHANGE')
    report={'whatsapp_sends':0,'production_changes':0,'permissions_changed':False}
    changed=False;backup=None;path=None;phase='preflight'
    try:
        if command(['hostname']).split('.')[0]!='srv1849463':raise RuntimeError('WRONG_HOST')
        base=Path(property('WorkingDirectory'))
        if str(base)!=BASE_PATH or base.is_symlink():raise RuntimeError('LAB_PATH_CHANGED')
        if hashlib.sha256((base/'server.py').read_bytes()).hexdigest()!=EXPECTED_SERVER:raise RuntimeError('LAB_CODE_DRIFT')
        env=process_env(property('MainPID'));require_configuration(env)
        if env.get('SANTANA_DATA_SOURCE','fixture')!='fixture' or env.get('SANTANA_SEND_ENABLED','false').lower()=='true' or env.get('SANTANA_SEND_MODE','disabled')!='disabled':raise RuntimeError('LAB_SEND_STATE_UNSAFE')
        target=base/'santana_batch_lab';path=target/'mcp_extension.py'
        if target.is_symlink() or path.is_symlink():raise RuntimeError('LAB_PATH_UNSAFE')
        digest=hashlib.sha256(path.read_bytes()).hexdigest()
        if digest==NEW_SHA:
            report.update(status='LAB_UI_METADATA_ALREADY_FIXED',tools=await_catalog(target/'launcher.py'),source='fixture',real_send_enabled=False)
            emit(report);return
        if digest!=OLD_SHA:raise RuntimeError('LAB_EXTENSION_CODE_DRIFT')
        if hashlib.sha256(PATCHED_CODE.encode()).hexdigest()!=NEW_SHA:raise RuntimeError('PATCH_INTEGRITY_MISMATCH')
        ast.parse(PATCHED_CODE)
        backup=BACKUP_PATH/('ui-metadata-'+time.strftime('%Y%m%dT%H%M%SZ')+'-'+str(time.time_ns()))
        backup.mkdir(parents=True,mode=0o700);shutil.copy2(path,backup/'mcp_extension.original.py')
        candidate=backup/'mcp_extension.candidate.py';candidate.write_text(PATCHED_CODE);candidate.chmod(0o600)
        report['backup']=str(backup)
        tunnel=property('MainPID','santana-mcp-lab-tunnel.service')
        phase='validate_private_tool_descriptor'
        clean={**env,'SANTANA_AUDIT_DB':':memory:','PYTHONDONTWRITEBYTECODE':'1'}
        smoke="import sys,importlib.util;sys.path[:0]=sys.argv[1:3];s=importlib.util.spec_from_file_location('mcp_extension',sys.argv[3]);m=importlib.util.module_from_spec(s);sys.modules['mcp_extension']=m;s.loader.exec_module(m);import launcher;v=launcher.server.dispatch({'jsonrpc':'2.0','id':1,'method':'tools/list'},('chatgpt','read'));t={x['name']:x for x in v['result']['tools']};assert len(t)==12;assert t['registrar_revisao_lote']['_meta']['ui']=={'visibility':['app']};assert t['preparar_lote']['_meta']['ui']['resourceUri']=='ui://santana/lab-batch-review.html';print('PRIVATE_DESCRIPTOR_PASS')"
        command(['/usr/bin/python3','-c',smoke,str(target),str(base),str(candidate)],cwd=base,env=clean)
        phase='replace_one_descriptor_field'
        tmp=target/('.mcp-ui-fix-'+str(time.time_ns())+'.tmp')
        shutil.copy2(candidate,tmp);tmp.chmod(0o600);os.replace(tmp,path);changed=True
        command(['systemctl','restart',UNIT])
        phase='verify_live_catalog'
        names=await_catalog(target/'launcher.py')
        report.update(status='LAB_UI_METADATA_FIXED',source='fixture',real_send_enabled=False,tools=names,lab_pid=property('MainPID'),lab_tunnel_pid_unchanged=tunnel==property('MainPID','santana-mcp-lab-tunnel.service'),private_tool='registrar_revisao_lote',private_visibility=['app'],private_render_resource=False)
        emit(report)
    except BaseException as error:
        report.update(status='LAB_UI_FIX_STOPPED_NO_SERVICE_CHANGE',phase=phase,**safe_error(error))
        if changed:
            try:
                tmp=path.parent/('.mcp-ui-restore-'+str(time.time_ns())+'.tmp')
                shutil.copy2(backup/'mcp_extension.original.py',tmp);os.replace(tmp,path)
                command(['systemctl','restart',UNIT])
                deadline=time.monotonic()+15
                while time.monotonic()<deadline and get_health()!=405:time.sleep(.3)
                restored=property('ActiveState')=='active' and get_health()==405 and hashlib.sha256(path.read_bytes()).hexdigest()==OLD_SHA
                report.update(status='LAB_UI_FIX_FAILED_RESTORED' if restored else 'LAB_UI_RESTORE_NOT_PROVEN',lab_restored=restored)
            except BaseException as restore_error:
                report.update(status='LAB_UI_RESTORE_NOT_PROVEN',restore_error=safe_error(restore_error))
        emit(report);raise SystemExit(1) from None
if __name__=='__main__':main()
