/** Render only permission/startup facts safe for the private LAB container log. */
const permission =
  /Requires\s+(read|write|env|net)\s+access\s+to\s+("[^"\r\n]{1,512}"|'[^'\r\n]{1,512}'|[^\s,;]{1,512})/i;
const framePattern = /(?:file:\/\/)?(\/[^\s():)]+\.(?:tsx?|mjs|js|json)):(\d{1,6})(?::(\d{1,6}))?/;
const runtimeFramePattern =
  /\bat\s+(?:async\s+)?([A-Za-z_$][A-Za-z0-9_.$]*)\s+\(ext:(deno_(?:fs|net|io)\/[A-Za-z0-9_./-]+\.js):(\d{1,6})(?::(\d{1,6}))?\)/;
const quotedPath = /["'](\/[^"'\r\n]{1,512})["']/;
const syscall = /\b(open|read|readfile|write|writefile|mkdir|rename|remove|connect|fetch|resolve)\b/i;

function safeResource(raw: string): string {
  const value = raw.trim().replace(/^["']|["']$/g, "").replace(/^file:\/\//i, "");
  if (/\/run\/secrets\//i.test(value)) return "/run/secrets/<redacted>";
  if (/\/lab-state\//i.test(value)) return "/lab-state/<file>";
  if (/(token|secret|credential|password|api[_-]?key|\.env)/i.test(value)) {
    return "<sensitive-resource>";
  }
  const safe = value.split("/").map((part) =>
    part.length > 80 || /^[A-Za-z0-9_-]{32,}$/.test(part) ? "<redacted>" : part
  ).join("/");
  return safe.slice(0, 512) || "UNKNOWN";
}

export function sanitizeStartupError(error: Error): string {
  const related = [error];
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) related.push(cause);
  const allowedTypes = new Set([
    "NotCapable",
    "PermissionDenied",
    "NotFound",
    "TypeError",
    "SyntaxError",
    "ReferenceError",
    "Error",
  ]);
  const type = allowedTypes.has(error.name) ? error.name : "Error";
  const matched = related.map((item) => ({ item, match: permission.exec(item.message) }))
    .find((entry) => entry.match);
  const match = matched?.match;
  const errorWithLocation = related.find((item) => {
    const candidate = item as Error & { syscall?: unknown; path?: unknown; filename?: unknown; resource?: unknown };
    return typeof candidate.syscall === "string" || typeof candidate.path === "string" ||
      typeof candidate.filename === "string" || typeof candidate.resource === "string";
  });
  const diagnosticError = errorWithLocation ?? matched?.item ?? error;
  const systemCallMatch = related.map((item) => syscall.exec(item.message)).find(Boolean);
  const properties = diagnosticError as Error & {
    syscall?: unknown;
    path?: unknown;
    filename?: unknown;
    resource?: unknown;
  };
  const systemCall = (typeof properties.syscall === "string" ? properties.syscall : systemCallMatch?.[1])
    ?.toLowerCase();
  const permissionOperation = match?.[1]?.toLowerCase();
  const stack = related.map((item) => item.stack ?? "").join("\n");
  const stackRuntimeCall = stack.split("\n").map((line) => runtimeFramePattern.exec(line)?.[1]?.toLowerCase()).find(
    Boolean,
  );
  const operation = permissionOperation ??
    (systemCall && ["write", "writefile", "mkdir", "rename", "remove"].includes(systemCall)
      ? "write"
      : systemCall && ["open", "read", "readfile", "stat", "lstat"].includes(systemCall)
      ? "read"
      : systemCall && ["connect", "fetch", "resolve", "bind", "listen", "accept"].includes(systemCall)
      ? "net"
      : stackRuntimeCall && ["bind", "listen", "accept", "connect"].includes(stackRuntimeCall)
      ? "net"
      : stackRuntimeCall && ["open", "read", "readfile", "stat", "lstat"].includes(stackRuntimeCall)
      ? "read"
      : stackRuntimeCall && ["write", "writefile", "mkdir", "rename", "remove", "chmod"].includes(stackRuntimeCall)
      ? "write"
      : "unknown");
  const path = related.map((item) => quotedPath.exec(item.message)?.[1]).find(Boolean);
  const propertyPath = [properties.path, properties.filename, properties.resource]
    .find((value): value is string => typeof value === "string" && value.length > 0);
  const rawResource = match?.[2] ?? path ?? propertyPath;
  const resource = rawResource ? safeResource(rawResource) : undefined;
  const frame = stack.split("\n").map((line) => {
    const found = framePattern.exec(line);
    if (found?.[1] && found[2]) return safeResource(found[1]) + ":" + found[2] + (found[3] ? ":" + found[3] : "");
    const runtime = runtimeFramePattern.exec(line);
    if (!runtime?.[1] || !runtime[2] || !runtime[3]) return undefined;
    return "ext:" + runtime[2] + ":" + runtime[3] + (runtime[4] ? ":" + runtime[4] : "");
  }).find(Boolean);
  const osError = related.map((item) => /permission denied\s+\(os error\s+(\d{1,3})\)/i.exec(item.message)?.[1]).find(
    Boolean,
  );
  const message = match
    ? "Requires " + operation + " access"
    : osError
    ? "Permission denied (os error " + osError + ")"
    : type;
  return [
    "SANA_LAB_STARTUP_DIAGNOSTIC",
    "ERROR_TYPE=" + type,
    "DENIED_OPERATION=" + operation,
    ...(resource ? ["DENIED_RESOURCE=" + resource] : []),
    ...(frame ? ["STACK_FRAME=" + frame] : []),
    "DENO_MESSAGE=" + message,
  ].join(" ");
}
