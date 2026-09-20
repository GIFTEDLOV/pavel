export function parseContractJson<T>(value: unknown, label: string): T {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is empty or malformed`);
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}
