const PHONE_PATTERN = /^\+55[0-9]{10,11}$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve((request) => {
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const expectedToken = Deno.env.get("SUPPORT_RUNTIME_PREFLIGHT_TOKEN") ?? "";
  const suppliedToken = request.headers.get("x-preflight-token") ?? "";
  if (!expectedToken || suppliedToken !== expectedToken) return json({ error: "UNAUTHORIZED" }, 401);

  const phone = Deno.env.get("SUPPORT_RUNTIME_CANARY_PHONE_E164") ?? "";
  const flag = Deno.env.get("CANARY_ENABLED");
  const singlePhone = phone.length > 0 && !/[\s,;|]/.test(phone);

  return json({
    phone_present: phone.length > 0,
    phone_valid_e164: singlePhone && PHONE_PATTERN.test(phone),
    single_phone: singlePhone,
    canary_enabled: flag === "true",
  });
});
