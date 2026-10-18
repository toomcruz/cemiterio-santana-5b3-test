const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function federatedAuthenticator(verifier,issuer,client,now=()=>Date.now()){
 return async token=>{
  const{data,error}=await verifier.auth.getUser(token);if(error||!data.user)return null;
  let c;try{c=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{return null;}
  if(c.sub!==data.user.id||!UUID.test(c.sub||'')||c.iss!==issuer||c.client_id!==client||c.aud!=='authenticated'||!UUID.test(c.session_id||'')||!Number.isFinite(c.exp)||c.exp<=now()/1000||c.nbf!==undefined&&(!Number.isFinite(c.nbf)||c.nbf>now()/1000))return null;
  return{subject:data.user.id,client_id:client};
 };
}
export async function productionIdentity(service,actor,client){
 const r=await service.rpc('sana_mcp_admin_identity',{p_subject:actor.subject,p_client:client});
 if(r.error||!r.data)throw Error('MCP_ADMIN_GRANT_REQUIRED');
 const u=await service.auth.admin.getUserById(r.data);
 if(u.error||u.data.user?.app_metadata?.sana_panel_operator!==true)throw Error('MCP_ADMIN_OPERATOR_REVOKED');
 return r.data;
}
