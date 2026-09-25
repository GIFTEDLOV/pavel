import { TransactionHashVariant, type CalldataEncodable } from "genlayer-js/types";
import type { PavelClient } from "@/lib/genlayer/client";
import { createPavelClient } from "@/lib/genlayer/client";
import { parseContractJson } from "./serialization";
import { CORE_ADDRESS, VAULT_ADDRESS } from "./network";
import type {
  AccountingRecord,
  AuthorizationView,
  ChallengeEvidenceRecord,
  ChallengeRecord,
  EvidenceRecord,
  IntentRecord,
  MandateRecord,
  ReservationRecord,
  SnapshotRecord,
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

export async function readSnapshot(client: PavelClient, core: `0x${string}`, snapshotId: string): Promise<SnapshotRecord | undefined> {
  return optionalJson<SnapshotRecord>(client, core, "get_snapshot", [snapshotId], `snapshot ${snapshotId}`);
}

async function readEvidenceState(client: PavelClient, intent: IntentRecord, sequence: number, snapshot?: SnapshotRecord): Promise<EvidenceRecord | undefined> {
  const definition = await readEvidence(client, CORE_ADDRESS, intent.intent_id, sequence);
  if (!definition) return undefined;
  const capture = snapshot && snapshot.challenge_id === undefined ? snapshot.captures.find((item) => item.evidence_id === definition.evidence_id) : undefined;
  return {
    ...definition,
    capture,
    snapshot_id: capture ? snapshot?.snapshot_id : undefined,
    captured: Boolean(capture),
    authenticated: capture?.capture_class === "AUTHENTICATED",
  };
}

async function readChallengeIds(client: PavelClient, intentId: string): Promise<string[]> {
  try {
    const count = Number(await rawView(client, CORE_ADDRESS, "get_challenge_count", [intentId]));
    const indexes = Array.from({ length: Math.min(Math.max(count, 0), 64) }, (_, index) => index);
    return (await Promise.all(indexes.map(async (index) => {
      try { return String(await rawView(client, CORE_ADDRESS, "get_challenge_id", [intentId, BigInt(index)])); } catch { return ""; }
    }))).filter(Boolean);
  } catch {
    return [];
  }
}

async function readChallengeEvidence(client: PavelClient, challengeId: string): Promise<ChallengeEvidenceRecord[]> {
  const records = await Promise.all(Array.from({ length: 8 }, (_, sequence) => optionalJson<ChallengeEvidenceRecord>(client, CORE_ADDRESS, "get_challenge_evidence", [challengeId, BigInt(sequence)], `challenge evidence ${challengeId}/${sequence}`)));
  return records.filter((record): record is ChallengeEvidenceRecord => Boolean(record));
}

async function readChallengesForIntent(client: PavelClient, intentId: string): Promise<{ challenges: ChallengeRecord[]; evidence: Record<string, ChallengeEvidenceRecord[]>; snapshots: Record<string, SnapshotRecord | undefined> }> {
  const ids = await readChallengeIds(client, intentId);
  const challenges = (await Promise.all(ids.map((id) => optionalJson<ChallengeRecord>(client, CORE_ADDRESS, "get_dispute", [id], `challenge ${id}`)))).filter((record): record is ChallengeRecord => Boolean(record));
  const evidenceEntries = await Promise.all(challenges.map(async (challenge) => [challenge.challenge_id, await readChallengeEvidence(client, challenge.challenge_id)] as const));
  const snapshotEntries = await Promise.all(challenges.filter((challenge) => Boolean(challenge.independent_snapshot_id)).map(async (challenge) => [challenge.challenge_id, await readSnapshot(client, CORE_ADDRESS, challenge.independent_snapshot_id)] as const));
  return { challenges, evidence: Object.fromEntries(evidenceEntries), snapshots: Object.fromEntries(snapshotEntries) };
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
  evidenceBySequence: Record<string, Record<string, EvidenceRecord | undefined>>;
  fulfillmentEvidence: Record<string, EvidenceRecord | undefined>;
  snapshots: Record<string, SnapshotRecord | undefined>;
  challenges: Record<string, ChallengeRecord[]>;
  challengeEvidence: Record<string, ChallengeEvidenceRecord[]>;
  challengeSnapshots: Record<string, SnapshotRecord | undefined>;
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
    const currentSnapshot = intent.current_snapshot_id ? await readSnapshot(client, CORE_ADDRESS, intent.current_snapshot_id) : undefined;
    const [authorization, reservation, settlement, authorizationEvidence, fulfillmentEvidence, challengeState] = await Promise.all([
      readAuthorization(client, CORE_ADDRESS, intent.intent_id),
      readReservation(client, VAULT_ADDRESS, intent.intent_id),
      readSettlementInstruction(client, CORE_ADDRESS, intent.intent_id),
      readEvidenceState(client, intent, 0, currentSnapshot),
      readEvidenceState(client, intent, 1, currentSnapshot),
      readChallengesForIntent(client, intent.intent_id),
    ]);
    return { intentId: intent.intent_id, authorization, reservation, settlement, authorizationEvidence, fulfillmentEvidence, currentSnapshot, challengeState };
  }));
  return {
    globalAccounting,
    mandates: mandateRecords,
    intents: intentRecords,
    accounting: Object.fromEntries(accountingEntries),
    authorizations: Object.fromEntries(intentEntries.map((entry) => [entry.intentId, entry.authorization])),
    reservations: Object.fromEntries(intentEntries.map((entry) => [entry.intentId, entry.reservation])),
    settlements: Object.fromEntries(intentEntries.map((entry) => [entry.intentId, entry.settlement])),
    evidence: Object.fromEntries(intentEntries.map((entry) => [entry.intentId, entry.authorizationEvidence])),
    evidenceBySequence: Object.fromEntries(intentEntries.map((entry) => [entry.intentId, { "0": entry.authorizationEvidence, "1": entry.fulfillmentEvidence }])),
    fulfillmentEvidence: Object.fromEntries(intentEntries.map((entry) => [entry.intentId, entry.fulfillmentEvidence])),
    snapshots: Object.fromEntries(intentEntries.filter((entry) => Boolean(entry.currentSnapshot)).map((entry) => [entry.currentSnapshot!.snapshot_id, entry.currentSnapshot])),
    challenges: Object.fromEntries(intentEntries.map((entry) => [entry.intentId, entry.challengeState.challenges])),
    challengeEvidence: Object.fromEntries(intentEntries.flatMap((entry) => Object.entries(entry.challengeState.evidence))),
    challengeSnapshots: Object.fromEntries(intentEntries.flatMap((entry) => Object.entries(entry.challengeState.snapshots))),
  };
}
