import { assertEquals } from "../fixtures/assert.ts";
import { runtimeMode } from "../../edge-functions/_shared/security.ts";
import { assertAConfirmarPlan } from "../../contracts/decision-plan.ts";
Deno.test("ENABLED fails closed instead of enabling runtime",()=>{Deno.env.set("SUPPORT_VNEXT_MODE","ENABLED");assertEquals(runtimeMode(),"OFF");});
Deno.test("A_CONFIRMAR rejects proposal and factual reference",()=>{const p:any={outcome:"A_CONFIRMAR",request_plan:{},actions:["CRIAR_SOLICITACAO"],response_plan:{allowed_fact_refs:[{type:"PRICE"}]}};assertEquals(assertAConfirmarPlan(p).length>0,true);});
