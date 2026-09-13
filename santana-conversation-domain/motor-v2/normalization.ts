export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

export function riskRank(level: "none" | "P3" | "P2" | "P1" | "P0"): number {
  return { none: 0, P3: 1, P2: 2, P1: 3, P0: 4 }[level];
}
