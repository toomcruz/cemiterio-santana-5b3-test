export interface RpcOnly {
  rpc<T>(name: string, body: unknown): Promise<T>;
}
