const GEN_SCALE = 10n ** 18n;
const DECIMAL_PATTERN = /^\d+(?:\.\d{1,18})?$/;
const RAW_PATTERN = /^\d+$/;

export function parseGen(input: string): bigint {
  if (typeof input !== "string") throw new TypeError("GEN amount must be text");
  const value = input.trim();
  if (!DECIMAL_PATTERN.test(value)) {
    throw new Error("Enter a non-negative GEN amount with at most 18 decimal places");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * GEN_SCALE + BigInt(fraction.padEnd(18, "0"));
}

export function formatGen(raw: bigint | string): string {
  const value = typeof raw === "bigint" ? raw : (() => {
    if (typeof raw !== "string" || !RAW_PATTERN.test(raw.trim())) throw new Error("Raw GEN units must be a non-negative integer");
    return BigInt(raw.trim());
  })();
  if (value < 0n) throw new Error("Raw GEN units cannot be negative");
  const whole = value / GEN_SCALE;
  const fraction = (value % GEN_SCALE).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
