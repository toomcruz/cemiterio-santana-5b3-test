import { HttpProblem } from "./http.ts";

const SHADOW_SCHEMA = "support_vnext_shadow";

export class SupabaseRest {
  private readonly url: string;
  private readonly key: string;

  constructor() {
    this.url = Deno.env.get("SUPABASE_URL") ?? "";
    this.key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!this.url || !this.key) {
      throw new HttpProblem(503, "SUPABASE_UNCONFIGURED", "Supabase runtime secrets are not configured");
    }
  }

  private headers(extra: HeadersInit = {}): HeadersInit {
    return {
      apikey: this.key,
      authorization: `Bearer ${this.key}`,
      accept: "application/json",
      "accept-profile": SHADOW_SCHEMA,
      "content-profile": SHADOW_SCHEMA,
      "content-type": "application/json",
      ...extra,
    };
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.url}/rest/v1${path}`, {
      ...init,
      headers: this.headers(init.headers),
    });
    const text = await response.text();
    const payload = text ? safeJson(text) : null;
    if (!response.ok) {
      throw new HttpProblem(
        502,
        "SUPABASE_REST_ERROR",
        typeof payload === "object" && payload ? JSON.stringify(payload) : text || response.statusText,
      );
    }
    return payload as T;
  }

  rpc<T>(name: string, body: unknown): Promise<T> {
    return this.request<T>(`/rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}

function safeJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}
