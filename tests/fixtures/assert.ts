export function assert(condition: unknown, message = "Assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertEquals<T>(actual: T, expected: T, message = "Values differ"): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}: expected ${right}; received ${left}`);
}

export async function assertRejects(fn: () => Promise<unknown> | unknown, pattern?: RegExp): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (!pattern || pattern.test(error instanceof Error ? error.message : String(error))) return;
    throw new Error(`Rejected with an unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error("Expected rejection");
}
