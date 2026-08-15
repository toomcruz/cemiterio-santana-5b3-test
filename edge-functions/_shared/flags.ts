import { SupabaseRest } from "./rest.ts";
export type FeatureTarget = {
  target_type: "CONVERSATION_ID" | "PHONE_HASH" | "SERVICE_CODE" | "COMPONENT" | "RELEASE_ID" | "GLOBAL";
  target_value?: string;
};
export async function resolveShadowFeature(
  rest: SupabaseRest,
  flagKey: string,
  candidates: FeatureTarget[],
): Promise<"OFF" | "SHADOW_ONLY"> {
  const safe = candidates.filter((x) => Boolean(x.target_value)).map((x) => ({
    target_type: x.target_type,
    target_value: x.target_value,
  }));
  safe.push({ target_type: "GLOBAL", target_value: "GLOBAL" });
  const r = await rest.rpc<{ mode: "OFF" | "SHADOW_ONLY" }>("resolve_shadow_feature", {
    p_flag_key: flagKey,
    p_candidates: safe,
  });
  return r.mode;
}
export async function requireShadowFeature(
  rest: SupabaseRest,
  key: string,
  candidates: FeatureTarget[],
): Promise<void> {
  if (await resolveShadowFeature(rest, key, candidates) !== "SHADOW_ONLY") {
    throw new Error("FEATURE_DISABLED_OR_NOT_SHADOW");
  }
}
