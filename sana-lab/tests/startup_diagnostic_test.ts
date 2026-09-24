import { sanitizeStartupError } from "../startup_diagnostic.ts";

Deno.test("startup diagnostic keeps permission path and stack without leaking secrets", () => {
  const secret = "synthetic-lab-secret-123456789";
  const error = new Deno.errors.PermissionDenied(
    'Requires read access to "/app/santana-authority/catalogo/exumacao.v1.json" Authorization: Bearer ' + secret,
  );
  error.stack = [
    "PermissionDenied: internal file contents must not be logged",
    "    at async Object.load (file:///app/santana-authority-gateway/catalogo/carregar.ts:128:19)",
  ].join("\n");
  const output = sanitizeStartupError(error);
  if (!output.includes("ERROR_TYPE=PermissionDenied")) throw Error("ERROR_TYPE_MISSING");
  if (!output.includes("DENIED_OPERATION=read")) throw Error("OPERATION_MISSING");
  if (!output.includes("DENIED_RESOURCE=/app/santana-authority/catalogo/exumacao.v1.json")) throw Error("PATH_MISSING");
  if (!output.includes("STACK_FRAME=/app/santana-authority-gateway/catalogo/carregar.ts:128:19")) {
    throw Error("FRAME_MISSING");
  }
  if (!output.includes("DENO_MESSAGE=Requires read access")) throw Error("MESSAGE_MISSING");
  if (
    output.includes(secret) || output.includes("Authorization") || output.includes("Bearer") ||
    output.includes("internal file contents")
  ) throw Error("SENSITIVE_DIAGNOSTIC_LEAK");
});

Deno.test("startup diagnostic redacts state and secret paths", () => {
  const secret = "synthetic-lab-secret-123456789";
  const error = new Deno.errors.PermissionDenied(
    'Requires write access to "/lab-state/' + secret + '.json"',
  );
  const output = sanitizeStartupError(error);
  if (!output.includes("DENIED_RESOURCE=/lab-state/<file>")) throw Error("STATE_PATH_NOT_REDACTED");
  if (output.includes(secret)) throw Error("STATE_IDENTIFIER_LEAK");
  const secretFile = sanitizeStartupError(
    new Deno.errors.PermissionDenied(
      'Requires read access to "/run/secrets/sana_lab_token"',
    ),
  );
  if (!secretFile.includes("DENIED_RESOURCE=/run/secrets/<redacted>")) throw Error("SECRET_PATH_NOT_REDACTED");
});

Deno.test("startup diagnostic preserves safe syscall path and source frame", () => {
  const error = Object.assign(new Deno.errors.PermissionDenied("Permission denied (os error 13)"), {
    syscall: "open",
    path: "/app/sana-lab/policy.json",
  });
  error.stack =
    "PermissionDenied: Permission denied (os error 13)\n    at loadPolicy (file:///app/sana-lab/runtime.ts:44:7)";
  const output = sanitizeStartupError(error);
  if (!output.includes("DENIED_OPERATION=read")) throw Error("SYSCALL_OPERATION_MISSING");
  if (!output.includes("DENIED_RESOURCE=/app/sana-lab/policy.json")) throw Error("SAFE_PATH_MISSING");
  if (!output.includes("STACK_FRAME=/app/sana-lab/runtime.ts:44:7")) throw Error("STACK_FRAME_MISSING");
});
