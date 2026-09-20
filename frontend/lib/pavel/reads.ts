import type { PavelClient } from "@/lib/genlayer/client";
import { parseContractJson } from "./serialization";
import type { AccountingRecord, IntentRecord, MandateRecord } from "./types";

export async function readMandate(client: PavelClient, core: `0x${string}`, id: string): Promise<MandateRecord> {
  const raw = await client.readContract({ address: core, functionName: "get_mandate", args: [id] });
  return parseContractJson<MandateRecord>(raw, `mandate ${id}`);
}

export async function readIntent(client: PavelClient, core: `0x${string}`, id: string): Promise<IntentRecord> {
  const raw = await client.readContract({ address: core, functionName: "get_intent", args: [id] });
  return parseContractJson<IntentRecord>(raw, `intent ${id}`);
}

export async function readAccounting(client: PavelClient, vault: `0x${string}`, mandateId: string): Promise<AccountingRecord> {
  const raw = await client.readContract({ address: vault, functionName: "get_accounting", args: [mandateId] });
  return parseContractJson<AccountingRecord>(raw, `accounting ${mandateId}`);
}
