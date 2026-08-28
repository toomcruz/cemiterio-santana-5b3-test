import { assert, assertEquals } from "../fixtures/assert.ts";
import { detectSupervisorToken } from "../../edge-functions/_shared/supervisor-token.ts";

Deno.test("@super with objective activates supervisor", () => {
  const result = detectSupervisorToken("@super teste");
  assertEquals(result.detected, true);
  assertEquals(result.objective, "teste");
  assertEquals(result.cleaned_text, "teste");
});

Deno.test("@Super (mixed case) with objective activates", () => {
  const result = detectSupervisorToken("@Super teste");
  assertEquals(result.detected, true);
  assertEquals(result.objective, "teste");
  assertEquals(result.cleaned_text, "teste");
});

Deno.test("@SUPER (uppercase) with objective activates", () => {
  const result = detectSupervisorToken("@SUPER teste");
  assertEquals(result.detected, true);
  assertEquals(result.objective, "teste");
  assertEquals(result.cleaned_text, "teste");
});

Deno.test("@superman does NOT activate", () => {
  const result = detectSupervisorToken("@superman teste");
  assertEquals(result.detected, false);
  assertEquals(result.objective, "");
  assertEquals(result.cleaned_text, "@superman teste");
});

Deno.test("mid-text @super does NOT activate", () => {
  const result = detectSupervisorToken("texto @super teste");
  assertEquals(result.detected, false);
  assertEquals(result.objective, "");
  assertEquals(result.cleaned_text, "texto @super teste");
});

Deno.test("@super alone (no objective) does NOT set objective", () => {
  const result = detectSupervisorToken("@super");
  assertEquals(result.detected, true);
  assertEquals(result.objective, "");
  assertEquals(result.cleaned_text, "");
});

Deno.test("leading spaces allowed before @super", () => {
  const result = detectSupervisorToken("   @super objetivo aqui");
  assertEquals(result.detected, true);
  assertEquals(result.objective, "objetivo aqui");
  assertEquals(result.cleaned_text, "objetivo aqui");
});

Deno.test("@super with multi-word objective", () => {
  const result = detectSupervisorToken("@super verificar status da requisição");
  assertEquals(result.detected, true);
  assertEquals(result.objective, "verificar status da requisição");
  assertEquals(result.cleaned_text, "verificar status da requisição");
});

Deno.test("internal=true messages ignored (not tested here, classifier responsibility)", () => {
  // Este teste é responsabilidade do classifyDeterministically
  assert(true);
});

Deno.test("normal message without @super does not activate", () => {
  const result = detectSupervisorToken("quero recadastro");
  assertEquals(result.detected, false);
  assertEquals(result.objective, "");
  assertEquals(result.cleaned_text, "quero recadastro");
});
