import { createPavelClient } from "./client";
import { rememberSubmittedTransaction, updateTransaction } from "./transaction-store";
import { explorerTransactionUrl } from "@/lib/pavel/network";
import type { TransactionHash } from "genlayer-js/types";

export type TrackedWrite = { hash: string; explorerUrl: string };

function isSuccessful(receipt: Awaited<ReturnType<ReturnType<typeof createPavelClient>["getTransaction"]>>): boolean {
  return receipt.statusName === "FINALIZED" && receipt.resultName === "SUCCESS" && receipt.txExecutionResultName === "FINISHED_WITH_RETURN";
}

export async function writeOnce(input: {
  actionKey: string;
  account: `0x${string}`;
  contract: `0x${string}`;
  method: string;
  args: readonly unknown[];
  write: Record<string, unknown>;
}): Promise<TrackedWrite> {
  const client = createPavelClient(input.account);
  const submitted = String(await client.writeContract({ value: 0n, ...input.write } as never));
  if (!/^0x[0-9a-fA-F]{64}$/.test(submitted)) throw new Error("GenLayer write did not return a transaction ID");
  const hash = submitted as TransactionHash;
  rememberSubmittedTransaction({ actionKey: input.actionKey, account: input.account, chainId: 61999, contract: input.contract, method: input.method, hash, args: [...input.args] });
  return { hash, explorerUrl: explorerTransactionUrl(hash) };
}

export async function reconcileTransaction(hash: string): Promise<"CONSENSUS" | "FINALIZED" | "EXECUTION_FAILED" | "AMBIGUOUS"> {
  try {
    const client = createPavelClient();
    const receipt = await client.getTransaction({ hash: hash as TransactionHash });
    if (receipt.statusName !== "FINALIZED") {
      updateTransaction(hash, "CONSENSUS");
      return "CONSENSUS";
    }
    if (!isSuccessful(receipt)) {
      updateTransaction(hash, "EXECUTION_FAILED", `${receipt.statusName}/${receipt.txExecutionResultName}`);
      return "EXECUTION_FAILED";
    }
    updateTransaction(hash, "FINALIZED");
    return "FINALIZED";
  } catch {
    updateTransaction(hash, "AMBIGUOUS", "Polling failed; resume reconciliation for the same transaction ID");
    return "AMBIGUOUS";
  }
}
