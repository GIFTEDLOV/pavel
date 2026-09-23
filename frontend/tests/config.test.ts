import { describe, expect, it } from "vitest";
import { configuredContracts } from "../lib/pavel/config";

describe("contract configuration honesty", () => {
  it("does not invent default addresses", () => {
    delete process.env.NEXT_PUBLIC_PAVEL_CORE_ADDRESS;
    delete process.env.NEXT_PUBLIC_PAVEL_VAULT_ADDRESS;
    expect(configuredContracts()).toEqual({
      core: "0xBA2356FfE5062506FA938da4715c03a2BE7929bF",
      vault: "0x552167Cc0883D02ce42fA2aD64E29Cd10EE3eDFD",
    });
  });

  it("rejects historical qualification-v1 addresses as runtime configuration", () => {
    process.env.NEXT_PUBLIC_PAVEL_CORE_ADDRESS = "0x572773E2Ab38AA5a546bcFC50bE25F209fB19159";
    expect(() => configuredContracts()).toThrow(/historical qualification-v1/);
    delete process.env.NEXT_PUBLIC_PAVEL_CORE_ADDRESS;
  });
});
