export type PavelAddress = `0x${string}`;

export type RootMandateWrite = {
  address: PavelAddress;
  functionName: "create_mandate";
  args: readonly [PavelAddress, ""];
  value: bigint;
};

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * SDK writeContract receives an args array, so the optional root parent ID is
 * represented as a real second element whose value is exactly "". Callers
 * must not use a sentinel or omit the element.
 */
export function buildRootMandateWrite(core: PavelAddress, agent: PavelAddress): RootMandateWrite {
  if (!ADDRESS_PATTERN.test(core) || !ADDRESS_PATTERN.test(agent)) {
    throw new Error("root Mandate addresses must be canonical 20-byte hexadecimal addresses");
  }
  return {
    address: core,
    functionName: "create_mandate",
    args: [agent, ""],
    value: 0n,
  };
}
