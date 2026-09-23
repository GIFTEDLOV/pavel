import { TransactionHashVariant, type CalldataEncodable } from "genlayer-js/types";
import type { PavelClient } from "@/lib/genlayer/client";
import { createPavelClient } from "@/lib/genlayer/client";
import { parseContractJson } from "./serialization";
import { CORE_ADDRESS, VAULT_ADDRESS } from "./network";
import type {
  AccountingRecord,
  AuthorizationView,
  EvidenceRecord,
  IntentRecord,
  MandateRecord,
  ReservationRecord,
  SettlementInstruction,
} from "./types";

const FINAL = { transactionHashVariant: TransactionHashVariant.LATEST_FINAL } as const;

async function rawView(client: PavelClient, address: `0x${string}`, functionName: string, args: CalldataEncodable[] = []): Promise<unknown> {
  return client.readContract({ address, functionName, args, ...FINAL });
}

async function optionalJson<T>(client: PavelClient, address: `0x${string}`, functionName: string, args: CalldataEncodable[], label: string): Promise<T | undefined> {
  try {
    const raw = await rawView(client, address, functionName, args);
    if (raw === "" || raw === undefined || raw === null) return undefined;
    return parseContractJson<T>(raw, label);
  } catch {
    return undefined;
  }
}

export async function readMandate(client: PavelClient, core: `0x${string}`, id: string): Promise<MandateRecord> {
  const raw = await rawView(client, core, "get_mandate", [id]);
  return parseContractJson<MandateRecord>(raw, `mandate ${id}`);
}

export async function readIntent(client: PavelClient, core: `0x${string}`, id: string): Promise<IntentRecord> {
  const raw = await rawView(client, core, "get_intent", [id]);
  return parseContractJson<IntentRecord>(raw, `intent ${id}`);
}

export async function readAccounting(client: PavelClient, vault: `0x${string}`, mandateId: string): Promise<AccountingRecord> {
  const raw = await rawView(client, vault, "get_accounting", [mandateId]);
  return parseContractJson<AccountingRecord>(raw, `accounting ${mandateId}`);
}

export async function readGlobalAccounting(client: PavelClient, vault: `0x${string}`): Promise<Record<string, string | boolean>> {
  const raw = await rawView(client, vault, "get_global_accounting");
  return parseContractJson<Record<string, string | boolean>>(raw, "global accounting");
}

export async function readAuthorization(client: PavelClient, core: `0x${string}`, intentId: string): Promise<AuthorizationView | undefined> {
  return optionalJson<AuthorizationView>(client, core, "get_authorization_for_vault", [intentId], `authorization ${intentId}`);
}

export async function readSettlementInstruction(client: PavelClient, core: `0x${string}`, intentId: string): Promise<SettlementInstruction | undefined> {
  return optionalJson<SettlementInstruction>(client, core, "get_settlement_instruction", [intentId], `settlement instruction ${intentId}`);
}

export async function readReservation(client: PavelClient, vault: `0x${string}`, intentId: string): Promise<ReservationRecord | undefined> {
  return optionalJson<ReservationRecord>(client, vault, "get_reservation", [intentId], `reservation ${intentId}`);
}

export async function readEvidence(client: PavelClient, core: `0x${string}`, intentId: string, sequence: number): Promise<EvidenceRecord | undefined> {
  return optionalJson<EvidenceRecord>(client, core, "get_evidence", [intentId, BigInt(sequence)], `evidence ${intentId}/${sequence}`);
}

export async function readSnapshot(client: PavelClient, core: `0x${string}`, snapshotId: string): Promise<Record<string, unknown> | undefined> {
  return optionalJson<Record<string, unknown>>(client, core, "get_snapshot", [snapshotId], `snapshot ${snapshotId}`);
}

async function readIds(client: PavelClient, method: "get_mandate_id" | "get_intent_id", countMethod: "get_mandate_count" | "get_intent_count", core: `0x${string}`): Promise<string[]> {
  try {
    const count = Number(await rawView(client, core, countMethod));
    const indexes = Array.from({ length: Math.min(Math.max(count, 0), 100) }, (_, index) => index);
    return (await Promise.all(indexes.map(async (index) => {
      try { return String(await rawView(client, core, method, [BigInt(index)])); } catch { return ""; }
    }))).filter(Boolean);
  } catch {
    return [];
  }
}

export interface ProtocolSnapshot {
  globalAccounting?: Record<string, string | boolean>;
  mandates: MandateRecord[];
  intents: IntentRecord[];
  accounting: Record<string, AccountingRecord | undefined>;
  authorizations: Record<string, AuthorizationView | undefined>;
  reservations: Record<string, ReservationRecord | undefined>;
  settlements: Record<string, SettlementInstruction | undefined>;
  evidence: Record<string, EvidenceRecord | undefined>;
}

export async function readProtocolSnapshot(options: { client?: PavelClient; intentId?: string; mandateId?: string } = {}): Promise<ProtocolSnapshot> {
  const client = options.client ?? createPavelClient();
  const [globalAccounting, mandateIds, intentIds] = await Promise.all([
    optionalJson<Record<string, string | boolean>>(client, VAULT_ADDRESS, "get_global_accounting", [], "global accounting"),
    readIds(client, "get_mandate_id", "get_mandate_count", CORE_ADDRESS),
    readIds(client, "get_intent_id", "get_intent_count", CORE_ADDRESS),
  ]);

  const requestedMandate = options.mandateId && !mandateIds.includes(options.mandateId) ? [options.mandateId] : [];
  const requestedIntent = options.intentId && !intentIds.includes(options.intentId) ? [options.intentId] : [];
  const [mandates, intents] = await Promise.all([
    Promise.all([...mandateIds, ...requestedMandate].map((id) => optionalJson<MandateRecord>(client, CORE_ADDRESS, "get_mandate", [id], `mandate ${id}`))),
    Promise.all([...intentIds, ...requestedIntent].map((id) => optionalJson<IntentRecord>(client, CORE_ADDRESS, "get_intent", [id], `intent ${id}`))),
  ]);
  const mandateRecords = mandates.filter((record): record is MandateRecord => Boolean(record));
  const intentRecords = intents.filter((record): record is IntentRecord => Boolean(record));
  const accountingEntries = await Promise.all(mandateRecords.map(async (mandate) => [mandate.mandate_id, await optionalJson<AccountingRecord>(client, VAULT_ADDRESS, "get_accounting", [mandate.mandate_id], `accounting ${mandate.mandate_id}`)] as const));
  const intentEntries = await Promise.all(intentRecords.map(async (intent) => {
    const [authorization, reservation, settlement, evidence] = await Promise.all([
      readAuthorization(client, CORE_ADDRESS, intent.intent_id),
      readReservation(client, VAULT_ADDRESS, intent.intent_id),
      readSettlementInstruction(client, CORE_ADDRESS, intent.intent_id),
      readEvidence(client, CORE_ADDRESS, intent.intent_id, 0),
    ]);
    return { intentId: intent.intent_id, authorization, reservation, settlement, evidence };
  }));
  return {
    globalAccounting,
    mandates: mandateRecords,
    intents: intentRecords,
    accounting: Object.fromEntries(accountingEntries),
    authorizations: Object.fromEntries(intentEntries.map((entry) => [entry.intentId, entry.authorization])),
    reservations: Object.fromEntries(intentEntries.map((entry) => [entry.intentId, entry.reservation])),
    settlements: Object.fromEntries(intentEntries.map((entry) => [entry.intentId, entry.settlement])),
    evidence: Object.fromEntries(intentEntries.map((entry) => [entry.intentId, entry.evidence])),
  };
}
