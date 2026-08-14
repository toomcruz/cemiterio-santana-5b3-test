type Query = Record<string, string>;

export class FakeRest {
  readonly calls: Array<{ method: string; table: string; query?: Query; body?: unknown }> = [];
  readonly rows = new Map<string, unknown[]>();
  readonly rpcHandlers = new Map<string, (body: unknown) => unknown | Promise<unknown>>();

  set(table: string, rows: unknown[]): this {
    this.rows.set(table, rows);
    return this;
  }

  async select<T>(table: string, query: Query = {}): Promise<T[]> {
    this.calls.push({ method: "select", table, query });
    return (this.rows.get(table) ?? []) as T[];
  }

  async selectOne<T>(table: string, query: Query): Promise<T | null> {
    this.calls.push({ method: "selectOne", table, query });
    return ((this.rows.get(table) ?? [])[0] ?? null) as T | null;
  }

  async insert<T>(table: string, body: unknown): Promise<T[]> {
    this.calls.push({ method: "insert", table, body });
    const rows = this.rows.get(table) ?? [];
    rows.push(body);
    this.rows.set(table, rows);
    return [body as T];
  }

  async update<T>(table: string, query: Query, body: unknown): Promise<T[]> {
    this.calls.push({ method: "update", table, query, body });
    return [];
  }

  async rpc<T>(name: string, body: unknown): Promise<T> {
    this.calls.push({ method: "rpc", table: name, body });
    const handler = this.rpcHandlers.get(name);
    if (!handler) throw new Error(`No RPC handler: ${name}`);
    return await handler(body) as T;
  }
}
