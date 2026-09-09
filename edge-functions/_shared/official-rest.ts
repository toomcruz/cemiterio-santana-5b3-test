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
      // Expose only stable conflict/auth categories, never raw database detail.
      let code = "";
      try {
        code = String(JSON.parse(text).code ?? "");
      } catch { /* no provider details */ }
      if (["55000", "40001", "23505"].includes(code)) {
        throw new HttpProblem(409, "RUNTIME_REVISION_CONFLICT", "Reload the attendance before retrying");
      }
      if (code === "42501") throw new HttpProblem(403, "OPERATOR_NOT_AUTHORIZED", "Operator access is required");
      if (code === "22023") {
        throw new HttpProblem(400, "RUNTIME_COMMAND_REJECTED", "The operation is not valid for this attendance");
      }
      throw new HttpProblem(502, "SUPABASE_RUNTIME_RPC_FAILED", "The runtime store did not accept the operation");
    }
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpProblem(502, "SUPABASE_RUNTIME_RPC_INVALID", "The runtime store returned an invalid response");
    }
  }

  /** Validate the live user session with Auth; never trust a user id in a payload. */
  async authenticatedUser(accessToken: string): Promise<string> {
    if (!accessToken || accessToken.length > 16000) {
      throw new HttpProblem(401, "USER_SESSION_REQUIRED", "A user session is required");
    }
    const response = await this.fetcher(this.url + "/auth/v1/user", {
      headers: this.headers({ authorization: "Bearer " + accessToken }),
    });
    if (!response.ok) throw new HttpProblem(401, "USER_SESSION_INVALID", "The user session is invalid");
    const user = await response.json();
    if (typeof user?.id !== "string") throw new HttpProblem(401, "USER_SESSION_INVALID", "The user session is invalid");
    return user.id;
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
