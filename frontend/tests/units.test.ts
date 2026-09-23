import { describe, expect, it } from "vitest";
import { formatGen, parseGen } from "../lib/pavel/units";

describe("GEN denomination boundary", () => {
  it.each([
    ["1", 1_000_000_000_000_000_000n],
    ["0.1", 100_000_000_000_000_000n],
    ["0.000000000000000001", 1n],
  ] as const)("parses %s GEN exactly", (input, expected) => {
    expect(parseGen(input)).toBe(expected);
  });

  it.each([
    [1_000_000_000_000_000_000n, "1"],
    [1n, "0.000000000000000001"],
  ] as const)("formats raw %s as %s GEN", (input, expected) => {
    expect(formatGen(input)).toBe(expected);
  });

  it.each(["-1", "1.0000000000000000001", "1e3", "", ".1", "1."]) ("rejects malformed amount %j", (input) => {
    expect(() => parseGen(input)).toThrow();
  });

  it("preserves exact bigint precision without Number conversion", () => {
    const raw = parseGen("123456789012345678901234567890.123456789012345678");
    expect(formatGen(raw)).toBe("123456789012345678901234567890.123456789012345678");
  });
});
