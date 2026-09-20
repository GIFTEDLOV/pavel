import { describe, expect, it } from "vitest";
import { stableJson } from "../lib/pavel/serialization";

describe("PAVEL serialization", () => {
  it("sorts object keys for transaction fingerprints", () => {
    expect(stableJson({ z: 1, a: { y: true, x: false } })).toBe('{"a":{"x":false,"y":true},"z":1}');
  });
});
