/**
 * Motor V2-only canonical JSON boundary.
 *
 * The existing runtime serializer remains unchanged. V2 rejects numeric
 * values that JSON cannot represent faithfully before hashing them.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const fields = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",");
    return `{${fields}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Motor V2 canonical JSON cannot encode a non-finite number");
  }
  return JSON.stringify(value) ?? "null";
}
