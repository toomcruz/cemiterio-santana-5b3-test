import {createLabReview} from './lab-review-core.mjs';
export function labReview(request:Request,admin:any,issuer:string){
 return createLabReview({
  authenticate:async(token:string)=>{
   const {data,error}=await admin.auth.getUser(token);if(error||!data.user)return null;
   let c;try{c=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{return null;}
   if(c.sub!==data.user.id||c.iss!==issuer||c.aud!=='authenticated'||!Number.isFinite(c.exp)||c.exp<=Date.now()/1000||c.nbf&&c.nbf>Date.now()/1000)return null;
   const password=Array.isArray(c.amr)?c.amr.find((x:any)=>x.method==='password'):null;
   return{subject:c.sub,session:c.session_id,client_id:c.client_id??c.azp??null,password_amr:Boolean(password),auth_time:password?.timestamp};
  },
  grant:async(subject:string)=>{const o=await admin.from('homolog_mcp_operators').select('is_active').eq('user_id',subject).maybeSingle();if(o.error||!o.data?.is_active)return null;const r=await admin.from('homolog_mcp_batch_lab_access').select('operator_id,is_active,expires_at').eq('subject_id',subject).maybeSingle();if(r.error)throw Error();return r.data;},
  sessionActive:async(owner:string,session:string)=>{const r=await admin.rpc('sana_mcp_session_active',{p_owner:owner,p_session:session});if(r.error)throw Error();return r.data===true;},
  save:async(row:any)=>{let r=await admin.from('homolog_mcp_batch_lab_receipts').upsert(row,{onConflict:'subject_id,batch_id,manifest_sha256,challenge_nonce',ignoreDuplicates:true});if(r.error)throw Error();r=await admin.from('homolog_mcp_batch_lab_receipts').select('receipt_id').eq('subject_id',row.subject_id).eq('batch_id',row.batch_id).eq('manifest_sha256',row.manifest_sha256).eq('challenge_nonce',row.challenge_nonce).single();if(r.error)throw Error();return r.data;},
 })(request);
}
