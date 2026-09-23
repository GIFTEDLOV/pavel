import { describe, expect, it } from "vitest";
import { waitForFinalizedTransaction, type PavelTransactionClient } from "../lib/genlayer/transactions";
import type { TransactionHash } from "genlayer-js/types";

describe("same-hash finalization", () => {
  it("uses the official finalization helper with the exact submitted hash", async () => {
    const seen: string[] = [];
    const hash = `0x${"a".repeat(64)}` as TransactionHash;
    const client = {
      waitForTransactionReceipt: async (input: { hash: string; status: string; fullTransaction: boolean }) => {
        seen.push(input.hash);
        expect(input.status).toBe("FINALIZED");
        expect(input.fullTransaction).toBe(true);
        return { statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN" };
      },
      getTransaction: async () => { throw new Error("fallback must not run"); },
    } as unknown as PavelTransactionClient;

    await waitForFinalizedTransaction(client, hash);
    expect(seen).toEqual([hash]);
  });
});
