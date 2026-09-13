import { canonicalJson } from "../../santana-conversation-domain/motor-v2/canonical_json.ts";
import { sha256 } from "../../santana-conversation-domain/runtime/server_transition.ts";
import type { ShadowCheckpoint, ShadowComparisonRecord, StoredShadowRecord } from "./types.ts";

const SAFE_ID = /^[a-z0-9_]{8,160}$/;

async function ensurePrivateDirectory(path: string): Promise<void> {
  await Deno.mkdir(path, { recursive: true, mode: 0o700 });
  const info = await Deno.lstat(path);
  if (!info.isDirectory || info.isSymlink) throw new Error("shadow store path must be a real directory");
  await Deno.chmod(path, 0o700);
}

async function atomicPrivateWrite(path: string, body: string): Promise<void> {
  const parent = path.slice(0, path.lastIndexOf("/"));
  await ensurePrivateDirectory(parent);
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const temporary = `${path}.tmp.${suffix}`;
  const file = await Deno.open(temporary, { createNew: true, write: true, mode: 0o600 });
  try {
    await file.write(new TextEncoder().encode(body));
    await file.sync();
  } finally {
    file.close();
  }
  await Deno.chmod(temporary, 0o600);
  await Deno.rename(temporary, path);
  await Deno.chmod(path, 0o600);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

export class DurableShadowStore {
  readonly #recordsDirectory: string;
  readonly #checkpointPath: string;
  readonly #locksDirectory: string;

  private constructor(
    readonly root: string,
    readonly cohortId: string,
    readonly cohortHash: string,
  ) {
    this.#recordsDirectory = `${root}/records`;
    this.#checkpointPath = `${root}/checkpoint.json`;
    this.#locksDirectory = `${root}/locks`;
  }

  static async open(root: string, cohortId: string, cohortHash: string): Promise<DurableShadowStore> {
    if (!SAFE_ID.test(cohortId) || !/^[a-f0-9]{64}$/.test(cohortHash)) {
      throw new Error("invalid shadow cohort identity");
    }
    await ensurePrivateDirectory(root);
    await ensurePrivateDirectory(`${root}/records`);
    await ensurePrivateDirectory(`${root}/tmp`);
    await ensurePrivateDirectory(`${root}/locks`);
    const store = new DurableShadowStore(root, cohortId, cohortHash);
    await store.rebuildCheckpoint();
    return store;
  }

  #recordPath(eventId: string): string {
    if (!SAFE_ID.test(eventId)) throw new Error("invalid shadow event id");
    return `${this.#recordsDirectory}/${eventId}.json`;
  }

  #lockPath(eventId: string): string {
    if (!SAFE_ID.test(eventId)) throw new Error("invalid shadow event id");
    return `${this.#locksDirectory}/${eventId}.lock`;
  }

  async #acquireLock(eventId: string): Promise<Deno.FsFile> {
    const path = this.#lockPath(eventId);
    try {
      const info = await Deno.lstat(path);
      if (!info.isFile || info.isSymlink) throw new Error("shadow lock path must be a regular file");
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    const file = await Deno.open(path, { create: true, read: true, write: true, mode: 0o600 });
    await file.lock(true);
    return file;
  }

  async get(eventId: string): Promise<StoredShadowRecord | null> {
    const path = this.#recordPath(eventId);
    try {
      const record = await readJson<StoredShadowRecord>(path);
      if (record.schema_version !== "phase18-shadow-store-record/1.0.0" || record.event_id !== eventId) {
        throw new Error("invalid persisted shadow record");
      }
      if (record.result.cohort_id !== this.cohortId || record.result.cohort_hash !== this.cohortHash) {
        throw new Error("persisted shadow record belongs to another cohort");
      }
      if (await sha256(canonicalJson(record.result)) !== record.result_hash) {
        throw new Error("persisted shadow result hash mismatch");
      }
      return structuredClone(record);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return null;
      throw error;
    }
  }

  async commit(
    eventId: string,
    inputHash: string,
    result: ShadowComparisonRecord,
    consolidatedAt: string,
  ): Promise<{ duplicate: boolean; record: StoredShadowRecord }> {
    if (!/^[a-f0-9]{64}$/.test(inputHash)) throw new Error("invalid shadow input hash");
    if (
      result.event_id !== eventId || result.input_hash !== inputHash || result.cohort_id !== this.cohortId ||
      result.cohort_hash !== this.cohortHash
    ) {
      throw new Error("shadow result identity or cohort mismatch");
    }
    const lock = await this.#acquireLock(eventId);
    try {
      const existing = await this.get(eventId);
      if (existing) {
        if (existing.input_hash !== inputHash) throw new Error("shadow event id reused with different content");
        return { duplicate: true, record: existing };
      }
      const record: StoredShadowRecord = {
        schema_version: "phase18-shadow-store-record/1.0.0",
        event_id: eventId,
        input_hash: inputHash,
        result_hash: await sha256(canonicalJson(result)),
        consolidated_at: consolidatedAt,
        result: structuredClone(result),
      };
      await atomicPrivateWrite(this.#recordPath(eventId), canonicalJson(record) + "\n");
      await this.rebuildCheckpoint();
      return { duplicate: false, record };
    } finally {
      await lock.unlock();
      lock.close();
    }
  }

  async list(): Promise<StoredShadowRecord[]> {
    const rows: StoredShadowRecord[] = [];
    for await (const entry of Deno.readDir(this.#recordsDirectory)) {
      if (!entry.isFile || !entry.name.endsWith(".json") || entry.name.includes(".tmp.")) continue;
      rows.push(await this.get(entry.name.slice(0, -5)) as StoredShadowRecord);
    }
    rows.sort((left, right) => left.event_id.localeCompare(right.event_id));
    return rows;
  }

  async rebuildCheckpoint(): Promise<ShadowCheckpoint> {
    const completed = (await this.list()).map((record) => record.event_id);
    const checkpoint: ShadowCheckpoint = {
      schema_version: "phase18-shadow-checkpoint/1.0.0",
      cohort_id: this.cohortId,
      cohort_hash: this.cohortHash,
      completed_event_ids: completed,
      completed_count: completed.length,
      last_event_id: completed.at(-1) ?? null,
      rebuilt_from_records: true,
    };
    await atomicPrivateWrite(this.#checkpointPath, canonicalJson(checkpoint) + "\n");
    return checkpoint;
  }

  checkpoint(): Promise<ShadowCheckpoint> {
    return readJson<ShadowCheckpoint>(this.#checkpointPath);
  }
}
