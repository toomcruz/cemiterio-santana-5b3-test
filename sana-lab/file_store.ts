import type { CaseState } from "./contracts.ts";
import type { Store } from "./engine.ts";

/** Isolated local LAB store. The lock and revision check serialize writes across local processes. */
export class FileStore implements Store {
  constructor(private root: string) { Deno.mkdirSync(root, { recursive: true }); }
  private path(id: string) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw Error("INVALID_CASE_ID");
    return `${this.root}/${id}.json`;
  }
  read(id: string): CaseState | undefined {
    try { return JSON.parse(Deno.readTextFileSync(this.path(id))) as CaseState; }
    catch (e) { if (e instanceof Deno.errors.NotFound) return undefined; throw e; }
  }
  commit(next: CaseState, expectedRevision: number): void {
    const path = this.path(next.case_id), lock = `${path}.lock`;
    Deno.mkdirSync(lock); // Existing lock fails closed; caller can retry deliberately.
    try {
      if ((this.read(next.case_id)?.revision ?? 0) !== expectedRevision) throw Error("REVISION_CONFLICT");
      const temp = `${path}.${crypto.randomUUID()}.tmp`;
      try { Deno.writeTextFileSync(temp, JSON.stringify(next)); Deno.renameSync(temp, path); }
      finally { try { Deno.removeSync(temp); } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; } }
    } finally { Deno.removeSync(lock); }
  }
}
