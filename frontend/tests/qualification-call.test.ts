import { describe, expect, it } from "vitest";
import { buildRootMandateWrite } from "../lib/pavel/qualification-call";

describe("root Mandate call-data regression", () => {
  it("retains the empty parent_mandate_id as the second SDK argument", () => {
    const call = buildRootMandateWrite(
      "0xBb5e144F1b93F5E7b1A5B3fE07ccf677B29b16EA",
      "0xCb5a845638Cbc1f95D7f8343278685682c3bA13F",
    );

    expect(call.functionName).toBe("create_mandate");
    expect(call.args).toHaveLength(2);
    expect(call.args[0]).toBe("0xCb5a845638Cbc1f95D7f8343278685682c3bA13F");
    expect(typeof call.args[0]).toBe("string");
    expect(call.args[1]).toBe("");
    expect(typeof call.args[1]).toBe("string");
  });

  it("rejects malformed addresses without changing the empty-string semantics", () => {
    expect(() => buildRootMandateWrite("0x0", "0x0")).toThrow(/20-byte/);
  });
});
