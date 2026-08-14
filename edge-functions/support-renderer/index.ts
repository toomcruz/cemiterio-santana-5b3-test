import { assertMethod, assertString, HttpProblem, json, parseJson, problem } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/rest.ts";
import { requireInternalShadowAccess, requireShadowOnly } from "../_shared/security.ts";
export interface RendererInput { decision_id:string; technical:{channel:"WHATSAPP"}; }
/** The database re-reads a persisted decision. Gemini is hard-disabled in this shadow package. */
export async function render(input:RendererInput,rest:SupabaseRest){const c=await rest.rpc<any>("get_renderer_decision_context",{p_decision_id:assertString(input.decision_id,"decision_id")});const p=c.response_plan;if(!p||c.outcome==='A_CONFIRMAR')throw new HttpProblem(409,"A_CONFIRMAR_NO_FACTS","No factual rendering allowed");if(p.mode==='GEMINI')throw new HttpProblem(503,"GEMINI_DISABLED","Gemini needs specific approval");return {decision_id:c.decision_id,mode:p.mode,template_id:p.template_id??null,authorized_field_keys:Object.keys(p.template_variables??{}),assets:p.asset_ids??[],shadow_only:true};}
if(import.meta.main) Deno.serve(async request=>{try{assertMethod(request,"POST");requireInternalShadowAccess(request);requireShadowOnly();return json(await render(await parseJson<RendererInput>(request),new SupabaseRest()));}catch(error){return problem(error);}});
