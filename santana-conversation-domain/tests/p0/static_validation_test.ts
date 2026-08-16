import { assertEquals } from "../../../tests/fixtures/assert.ts";
import { validateCatalogs, validateState } from "../../engine/validate.ts";
import { initState } from "../../engine/engine.ts";

Deno.test("P0-STATIC: catalogos v1 sao internamente consistentes", () => {
  assertEquals(validateCatalogs(), []);
});

Deno.test("P0-STATIC: estado inicial conforma com state.schema.json", () => {
  assertEquals(validateState(initState("conv-static")), []);
});
