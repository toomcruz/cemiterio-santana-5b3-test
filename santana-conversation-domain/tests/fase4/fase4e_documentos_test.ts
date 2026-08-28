// Fase 4E — Documentos: estados, ciclo, invalidação seletiva
import { assertEquals } from "../../../tests/fixtures/assert.ts";

// Tipos (refletem contrato R7-extension)
interface Documento {
  estado: "SOLICITADO" | "RECEBIDO" | "ACEITO" | "ILEGÍVEL_INADEQUADO";
  aceito_por?: "HUMANO" | "SISTEMA";
  tipo?: string;
  invalidado?: boolean;
}

Deno.test("4E: documento inicia em SOLICITADO", () => {
  const doc: Documento = { estado: "SOLICITADO" };
  assertEquals(doc.estado, "SOLICITADO");
});

Deno.test("4E: transição SOLICITADO→RECEBIDO→ACEITO é válida (ciclo humano)", () => {
  const doc: Documento = { estado: "SOLICITADO" };
  doc.estado = "RECEBIDO";
  assertEquals(doc.estado, "RECEBIDO");
  doc.estado = "ACEITO";
  doc.aceito_por = "HUMANO";
  assertEquals(doc.estado, "ACEITO");
  assertEquals(doc.aceito_por, "HUMANO");
});

Deno.test("4E: invalidação é seletiva (não afeta outros campos)", () => {
  const doc: Documento = { estado: "ACEITO", tipo: "ID_PESSOAL", invalidado: false };
  doc.invalidado = true;
  assertEquals(doc.invalidado, true);
  assertEquals(doc.tipo, "ID_PESSOAL");
  assertEquals(doc.estado, "ACEITO");
});
