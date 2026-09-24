/** Technical startup guard for the SAME private bridge; never substitutes business logic. */
if (import.meta.main) {
  try {
    const { serveLabBridge } = await import("./bridge.ts");
    serveLabBridge();
  } catch (cause) {
    const error = cause instanceof Error ? cause : Error("UNKNOWN_STARTUP_FAILURE");
    const code = /^[A-Z][A-Z0-9_]{2,64}$/.test(error.message) ? error.message :
      error.name === "NotCapable" ? "NOT_CAPABLE" :
      error.name === "PermissionDenied" ? "PERMISSION_DENIED" : "STARTUP_FAILURE";
    const tokenFile = Deno.env.get("SANA_LAB_TOKEN_FILE") ?? "";
    let token = "";
    try { token = Deno.readTextFileSync(tokenFile).trim(); } catch { /* fail closed */ }
    const bytes = new TextEncoder();
    const same = (x: string, y: string) => {
      const a = bytes.encode(x), b = bytes.encode(y);
      let difference = a.length ^ b.length;
      for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
      return difference === 0;
    };
    const hostname = Deno.env.get("SANA_LAB_BIND_HOST") ?? "127.0.0.1";
    const port = Number(Deno.env.get("SANA_LAB_PORT") ?? "8765");
    Deno.serve({ hostname, port }, (request) => {
      if (new URL(request.url).pathname !== "/lab/v1/turn" || request.method !== "POST") return new Response(null, { status: 404 });
      if (!token || !same(request.headers.get("authorization") ?? "", `Bearer ${token}`)) return new Response(null, { status: 401 });
      return new Response(JSON.stringify({ error: "LAB_STARTUP_FAILED", code }), {
        status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    });
  }
}
