import { createPavelClient } from "./client";
import { rememberSubmittedTransaction, updateTransaction } from "./transaction-store";
import { explorerTransactionUrl } from "@/lib/pavel/network";
import { isDurableExecutionSuccess } from "@/lib/pavel/transaction-status";
import type { TransactionHash } from "genlayer-js/types";

export type TrackedWrite = { hash: string; explorerUrl: string };
export type PavelTransactionClient = ReturnType<typeof createPavelClient>;

const FINALIZATION_INTERVAL_MS = 3_000;
const FINALIZATION_RETRIES = 10;

function hasFinalizationHelper(client: PavelTransactionClient): client is PavelTransactionClient & { waitForTransactionReceipt: (args: { hash: TransactionHash; status: "FINALIZED"; interval: number; retries: number; fullTransaction: true }) => Promise<Awaited<ReturnType<PavelTransactionClient["getTransaction"]>>> } {
  return typeof (client as { waitForTransactionReceipt?: unknown }).waitForTransactionReceipt === "function";
}

export async function waitForFinalizedTransaction(client: PavelTransactionClient, hash: TransactionHash): Promise<Awaited<ReturnType<PavelTransactionClient["getTransaction"]>>> {
  if (hasFinalizationHelper(client)) {
    return client.waitForTransactionReceipt({ hash, status: "FINALIZED", interval: FINALIZATION_INTERVAL_MS, retries: FINALIZATION_RETRIES, fullTransaction: true });
  }

  let last: Awaited<ReturnType<PavelTransactionClient["getTransaction"]>> | undefined;
  for (let attempt = 0; attempt <= FINALIZATION_RETRIES; attempt += 1) {
    last = await client.getTransaction({ hash });
    if (last.statusName === "FINALIZED") return last;
    if (attempt < FINALIZATION_RETRIES) await new Promise((resolve) => setTimeout(resolve, FINALIZATION_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for transaction ${hash} to reach FINALIZED`);
}

export async function writeOnce(input: {
  actionKey: string;
  account: `0x${string}`;
  contract: `0x${string}`;
  method: string;
  args: readonly unknown[];
  write: Record<string, unknown>;
  provider?: { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
}): Promise<TrackedWrite> {
  const client = createPavelClient(input.account, input.provider);
  // The caller supplies the already-validated write request. The client call
  // happens exactly once; persistence begins immediately after the hash is
  // returned so timeouts never trigger a blind rebroadcast.
  const submitted = String(await client.writeContract({ value: 0n, ...input.write } as never));
  if (!/^0x[0-9a-fA-F]{64}$/.test(submitted)) throw new Error("GenLayer write did not return a transaction ID");
  const hash = submitted as TransactionHash;
  rememberSubmittedTransaction({ actionKey: input.actionKey, account: input.account, chainId: 61999, contract: input.contract, method: input.method, hash, args: [...input.args] });
  return { hash, explorerUrl: explorerTransactionUrl(hash) };
}

export async function reconcileTransaction(hash: string): Promise<"CONSENSUS" | "FINALIZED" | "EXECUTION_FAILED" | "AMBIGUOUS"> {
  try {
    const client = createPavelClient();
    const receipt = await waitForFinalizedTransaction(client, hash as TransactionHash);
    if (receipt.statusName !== "FINALIZED") {
      updateTransaction(hash, "CONSENSUS");
      return "CONSENSUS";
    }
    if (!isDurableExecutionSuccess(receipt)) {
      updateTransaction(hash, "EXECUTION_FAILED", `${receipt.statusName}/${receipt.txExecutionResultName}`);
      return "EXECUTION_FAILED";
    }
    updateTransaction(hash, "FINALIZED");
    return "FINALIZED";
  } catch {
    updateTransaction(hash, "AMBIGUOUS", "Finalization polling failed or timed out; resume reconciliation for the same transaction ID");
    return "AMBIGUOUS";
  }
}
