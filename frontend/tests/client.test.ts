import { describe, expect, it } from "vitest";
import { createPavelClient } from "../lib/genlayer/client";

describe("account-free read client", () => {
  it("constructs without an account or wallet provider", () => {
    const client = createPavelClient();
    expect(client).toBeDefined();
    expect(typeof client.readContract).toBe("function");
  });
});
