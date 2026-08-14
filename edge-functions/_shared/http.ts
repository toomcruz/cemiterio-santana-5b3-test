export const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export class HttpProblem extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

export function problem(error: unknown): Response {
  if (error instanceof HttpProblem) return json({ error: error.code, message: error.message }, error.status);
  console.error("Unhandled vNext shadow error", error instanceof Error ? error.message : String(error));
  return json({ error: "INTERNAL_ERROR", message: "Internal shadow component error" }, 500);
}

export async function parseJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new HttpProblem(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

export function assertMethod(request: Request, method = "POST"): void {
  if (request.method !== method) throw new HttpProblem(405, "METHOD_NOT_ALLOWED", `Use ${method}`);
}

export function assertString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new HttpProblem(400, "INVALID_INPUT", `${name} is required`);
  return value.trim();
}
