/** Effect-free type contract shared by the adapter and concrete network boundary. */
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
