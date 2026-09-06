// Fase 4E — testes do ciclo real de documentos.
import { assertEquals, assertRejects } from "../../../tests/fixtures/assert.ts";
import { createDocumento, transitionDocumento, valideAccept } from "../../engine/documento.ts";
import { initState } from "../../engine/engine.ts";
import { validateState } from "../../engine/validate.ts";

const T0 = "2026-09-06T10:00:00Z";
const T1 = "2026-09-06T10:01:00Z";
const T2 = "2026-09-06T10:02:00Z";

Deno.test("4E: documento nasce SOLICITADO e o estado valida no schema", () => {
  const doc = createDocumento({
    documento_id: "doc-1",
    case_id: "case-1",
    tipo: "ID_PESSOAL",
    solicitado_em: T0,
  });
  const state = { ...initState("conv-4e"), documentos: [doc] };
  assertEquals(doc.estado, "SOLICITADO");
  assertEquals(validateState(state), []);
});

Deno.test("4E: ciclo SOLICITADO→RECEBIDO→ACEITO exige humano", async () => {
  const requested = createDocumento({
    documento_id: "doc-2",
    case_id: null,
    tipo: "CERTIDAO",
    solicitado_em: T0,
  });
  const received = transitionDocumento(requested, "RECEBIDO", { ocorrido_em: T1 });
  assertEquals(valideAccept(received, "SISTEMA"), false);
  await assertRejects(
    () => transitionDocumento(received, "ACEITO", { ocorrido_em: T2, autoridade: "SISTEMA" }),
    /HUMANA/,
  );
  const accepted = transitionDocumento(received, "ACEITO", {
    ocorrido_em: T2,
    autoridade: "HUMANO",
  });
  assertEquals(accepted.aceito_por, "HUMANO");
  assertEquals(accepted.estado, "ACEITO");
});

Deno.test("4E: invalidação é seletiva e transições inválidas falham fechadas", async () => {
  const requested = createDocumento({
    documento_id: "doc-3",
    case_id: "case-3",
    tipo: "CONTRATO",
    descricao: "frente e verso",
    solicitado_em: T0,
  });
  await assertRejects(
    () => transitionDocumento(requested, "ACEITO", { ocorrido_em: T1, autoridade: "HUMANO" }),
    /transicao de documento invalida/,
  );
  const received = transitionDocumento(requested, "RECEBIDO", { ocorrido_em: T1 });
  const accepted = transitionDocumento(received, "ACEITO", {
    ocorrido_em: T2,
    autoridade: "HUMANO",
  });
  const invalidated = transitionDocumento(accepted, "INVALIDADO", {
    ocorrido_em: "2026-09-06T10:03:00Z",
  });
  assertEquals(invalidated.documento_id, accepted.documento_id);
  assertEquals(invalidated.tipo, "CONTRATO");
  assertEquals(invalidated.descricao, "frente e verso");
  assertEquals(invalidated.estado, "INVALIDADO");
});
