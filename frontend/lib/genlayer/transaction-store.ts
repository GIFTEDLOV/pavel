import { stableJson } from "@/lib/pavel/serialization";

export type StoredTransaction = {
  actionKey: string;
  account: string;
  chainId: number;
  contract: string;
  method: string;
  argsFingerprint: string;
  hash: string;
  submittedAt: number;
  stage: "SUBMITTED" | "CONSENSUS" | "FINALIZED" | "EXECUTION_FAILED" | "AMBIGUOUS";
  error?: string;
};

const KEY = "pavel:transactions:v1";
export const TRANSACTION_EVENT = "pavel:transactions-changed";

function read(): StoredTransaction[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as StoredTransaction[]; } catch { return []; }
}

function write(items: StoredTransaction[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, stableJson(items));
  window.dispatchEvent(new Event(TRANSACTION_EVENT));
}

export function rememberSubmittedTransaction(input: Omit<StoredTransaction, "argsFingerprint" | "submittedAt" | "stage"> & { args: unknown[] }): StoredTransaction {
  const item: StoredTransaction = { ...input, argsFingerprint: stableJson(input.args), submittedAt: Date.now(), stage: "SUBMITTED" };
  write([item, ...read().filter((old) => old.actionKey !== item.actionKey || old.account.toLowerCase() !== item.account.toLowerCase())]);
  return item;
}

export function updateTransaction(hash: string, stage: StoredTransaction["stage"], error?: string): void {
  write(read().map((item) => item.hash === hash ? { ...item, stage, ...(error ? { error } : {}) } : item));
}

export function allTransactions(): StoredTransaction[] { return read(); }
