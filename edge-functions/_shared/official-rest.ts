import { HttpProblem } from "./http.ts";

export interface OfficialRestOptions {
  url?: string;
  serviceRoleKey?: string;
  fetcher?: typeof fetch;
}

/**
 * REST boundary for the definitive runtime. Unlike the old shadow client, it
 * never selects a legacy schema and only reaches explicitly service-only RPCs.
 */
export class OfficialSupabaseRest {
  private readonly url: string;
  private readonly key: string;
  private readonly fetcher: typeof fetch;

  constructor(options: OfficialRestOptions = {}) {
    this.url = options.url ?? Deno.env.get("SUPABASE_URL") ?? "";
    this.key = options.serviceRoleKey ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    this.fetcher = options.fetcher ?? fetch;
    if (!this.url || !this.key) {
      throw new HttpProblem(503, "SUPABASE_UNCONFIGURED", "Supabase runtime secrets are not configured");
    }
  }

  private headers(extra: HeadersInit = {}): HeadersInit {
    return {
      apikey: this.key,
      authorization: "Bearer " + this.key,
      accept: "application/json",
      "content-type": "application/json",
      ...extra,
    };
  }

  async rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.fetcher(this.url + "/rest/v1/rpc/" + encodeURIComponent(name), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new HttpProblem(502, "SUPABASE_RUNTIME_RPC_FAILED", "The runtime store did not accept the operation");
    }
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpProblem(502, "SUPABASE_RUNTIME_RPC_INVALID", "The runtime store returned an invalid response");
    }
  }

  async uploadObject(bucket: string, path: string, bytes: ArrayBuffer, mimeType: string): Promise<void> {
    const response = await this.fetcher(this.objectUrl(bucket, path), {
      method: "POST",
      headers: this.headers({
        "content-type": mimeType,
        "x-upsert": "false",
      }),
      body: bytes,
    });
    if (!response.ok) {
      throw new HttpProblem(502, "SUPABASE_STORAGE_UPLOAD_FAILED", "The attachment could not be stored");
    }
  }

  async removeObject(bucket: string, path: string): Promise<void> {
    const response = await this.fetcher(this.url + "/storage/v1/object/" + encodeURIComponent(bucket), {
      method: "DELETE",
      headers: this.headers(),
      body: JSON.stringify({ prefixes: [path] }),
    });
    if (!response.ok) {
      throw new HttpProblem(502, "SUPABASE_STORAGE_DELETE_FAILED", "The temporary attachment could not be removed");
    }
  }

  private objectUrl(bucket: string, path: string): string {
    const encodedPath = path.split("/").map((part) => encodeURIComponent(part)).join("/");
    return this.url + "/storage/v1/object/" + encodeURIComponent(bucket) + "/" + encodedPath;
  }
}
