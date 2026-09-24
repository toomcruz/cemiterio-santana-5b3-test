/** Render only permission/startup facts safe for the private LAB container log. */
const permission = /Requires\s+(read|write|env|net)\s+access\s+to\s+("[^"\r\n]{1,512}"|'[^'\r\n]{1,512}'|[^\s,;]{1,512})/i;
const framePattern = /(?:file:\/\/)?(\/[^\s():)]+\.(?:tsx?|mjs|js|json)):(\d{1,6})(?::(\d{1,6}))?/;
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
  const allowedTypes = new Set([
    "NotCapable", "PermissionDenied", "NotFound", "TypeError", "SyntaxError",
    "ReferenceError", "Error",
  ]);
  const type = allowedTypes.has(error.name) ? error.name : "Error";
  const match = permission.exec(error.message);
  const systemCall = syscall.exec(error.message)?.[1].toLowerCase();
  const operation = match?.[1].toLowerCase() ??
    (systemCall && ["write", "writefile", "mkdir", "rename", "remove"].includes(systemCall) ? "write" :
      systemCall && ["read", "readfile"].includes(systemCall) ? "read" :
        systemCall && ["connect", "fetch", "resolve"].includes(systemCall) ? "net" : "unknown");
  const path = quotedPath.exec(error.message)?.[1];
  const resource = match ? safeResource(match[2]) : path ? safeResource(path) : undefined;
  const frame = error.stack?.split("\n").map((line) => {
    const found = framePattern.exec(line);
    if (!found) return undefined;
    const path = safeResource(found[1]);
    return path + ":" + found[2] + (found[3] ? ":" + found[3] : "");
  }).find(Boolean);
  const osError = /permission denied\s+\(os error\s+(\d{1,3})\)/i.exec(error.message)?.[1];
  const message = match
    ? "Requires " + operation + " access"
    : osError ? "Permission denied (os error " + osError + ")" : type;
  return [
    "SANA_LAB_STARTUP_DIAGNOSTIC",
    "ERROR_TYPE=" + type,
    "DENIED_OPERATION=" + operation,
    ...(resource ? ["DENIED_RESOURCE=" + resource] : []),
    ...(frame ? ["STACK_FRAME=" + frame] : []),
    "DENO_MESSAGE=" + message,
  ].join(" ");
}
