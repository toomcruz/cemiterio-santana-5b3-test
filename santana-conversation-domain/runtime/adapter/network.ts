/** The adapter's only network boundary. Keep credentials out of callers and logs. */
import type { NetworkBoundary } from "./network_types.ts";
export type { NetworkBoundary, NetworkRequest, NetworkResponse } from "./network_types.ts";

export const fetchBoundary: NetworkBoundary = async (request, signal) => {
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    signal,
  });
  return {
    status: response.status,
    body: await response.text(),
    headers: { "content-type": response.headers.get("content-type") ?? "" },
  };
};
