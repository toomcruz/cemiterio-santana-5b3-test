/** The adapter's only network boundary. Keep credentials out of callers and logs. */
export interface NetworkRequest {
  url: string;
  headers: Readonly<Record<string, string>>;
  body: string;
}

export interface NetworkResponse {
  status: number;
  body: string;
}

export type NetworkBoundary = (request: NetworkRequest, signal: AbortSignal) => Promise<NetworkResponse>;

export const fetchBoundary: NetworkBoundary = async (request, signal) => {
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    signal,
  });
  return { status: response.status, body: await response.text() };
};
