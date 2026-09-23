import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdkRoot = resolve(root, "frontend", "node_modules", "genlayer-js", "dist");
const { createClient } = await import(pathToFileURL(resolve(sdkRoot, "index.js")));
const { TransactionHashVariant } = await import(pathToFileURL(resolve(sdkRoot, "types", "index.js")));
const { studionet } = await import(pathToFileURL(resolve(sdkRoot, "chains", "index.js")));

const CORE = "0xBA2356FfE5062506FA938da4715c03a2BE7929bF";
const VAULT = "0x552167Cc0883D02ce42fA2aD64E29Cd10EE3eDFD";
const RPC = "https://studio.genlayer.com/api";
const CHAIN_ID = 61999;
const FINAL = TransactionHashVariant.LATEST_FINAL;
const outputDir = resolve(root, "deployments", "studionet", "qualification-v7");

if (studionet.id !== CHAIN_ID || studionet.rpcUrls?.default?.http?.[0] !== RPC) {
  throw new Error("PAVEL canonical proof capture: SDK network is not stable Studionet 61999");
}

const client = createClient({ chain: studionet });
const reads = [];

function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  if (typeof value === "string") {
    try { return jsonSafe(JSON.parse(value)); } catch { return value; }
  }
  return value;
}

async function read(contract, label, method, args = []) {
  const observed = jsonSafe(await client.readContract({
    address: contract,
    functionName: method,
    args,
    transactionHashVariant: FINAL,
  }));
  reads.push({ contract: label, address: contract, method, args: jsonSafe(args), transactionHashVariant: "LATEST_FINAL", observed });
  return observed;
}

function requiredObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`PAVEL canonical proof capture: ${label} was unavailable`);
  return value;
}

const binding = {
  coreVaultAddress: await read(CORE, "Core", "get_vault_address"),
  vaultCoreAddress: await read(VAULT, "Vault", "get_core_address"),
};
const counts = {
  mandateCount: Number(await read(CORE, "Core", "get_mandate_count")),
  intentCount: Number(await read(CORE, "Core", "get_intent_count")),
  coreHistoryLength: String(await read(CORE, "Core", "get_history_length")),
  vaultHistoryLength: String(await read(VAULT, "Vault", "get_history_length")),
};

const mandateIds = [];
for (let index = 0; index < counts.mandateCount; index += 1) {
  mandateIds.push(String(await read(CORE, "Core", "get_mandate_id", [BigInt(index)])));
}
const intentIds = [];
for (let index = 0; index < counts.intentCount; index += 1) {
  intentIds.push(String(await read(CORE, "Core", "get_intent_id", [BigInt(index)])));
}

const mandates = {};
const accounting = {};
for (const mandateId of mandateIds) {
  mandates[mandateId] = requiredObject(await read(CORE, "Core", "get_mandate", [mandateId]), `mandate ${mandateId}`);
  accounting[mandateId] = requiredObject(await read(VAULT, "Vault", "get_accounting", [mandateId]), `accounting ${mandateId}`);
}

const intents = {};
const globalAccounting = requiredObject(await read(VAULT, "Vault", "get_global_accounting"), "global accounting");
for (const intentId of intentIds) {
  const intent = requiredObject(await read(CORE, "Core", "get_intent", [intentId]), `intent ${intentId}`);
  const authorization = requiredObject(await read(CORE, "Core", "get_authorization_for_vault", [intentId]), `authorization ${intentId}`);
  const reservation = requiredObject(await read(VAULT, "Vault", "get_reservation", [intentId]), `reservation ${intentId}`);
  const settlementInstruction = requiredObject(await read(CORE, "Core", "get_settlement_instruction", [intentId]), `settlement instruction ${intentId}`);
  const settlement = requiredObject(await read(VAULT, "Vault", "get_settlement", [reservation.settlement_id]), `settlement ${intentId}`);
  const evidence = requiredObject(await read(CORE, "Core", "get_evidence", [intentId, 0n]), `evidence ${intentId}`);
  intents[intentId] = { intent, authorization, reservation, settlementInstruction, settlement, evidence };
}

const proof = {
  proofVersion: "v7-canonical-readback-1",
  captureScript: "scripts/capture-v7-canonical-proof.mjs",
  capturedAt: new Date().toISOString(),
  network: "studionet",
  chainId: CHAIN_ID,
  rpc: RPC,
  core: CORE,
  vault: VAULT,
  transactionHashVariant: "LATEST_FINAL",
  canonicalQualificationState: "FULFILLED_RELEASE_PENDING_EXTERNAL_UNCONFIRMED",
  externalSettlementStatus: "UNCONFIRMED",
  binding,
  counts,
  mandateIds,
  intentIds,
  qualifiedIdentities: Object.fromEntries(intentIds.map((intentId) => {
    const intent = intents[intentId].intent;
    return [intentId, { principal: intent.principal, agent: intent.agent, mandateId: intent.mandate_id, counterpartyIdentityId: intent.counterparty_identity_id }];
  })),
  mandates,
  intents,
  accounting,
  globalAccounting,
  readCount: reads.length,
  writeCount: 0,
  reads,
};

mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, "canonical-readback.json"), `${JSON.stringify(proof, null, 2)}\n`, "utf8");
writeFileSync(resolve(outputDir, "proof-index.json"), `${JSON.stringify({
  proofVersion: proof.proofVersion,
  network: proof.network,
  chainId: proof.chainId,
  rpc: proof.rpc,
  transactionHashVariant: proof.transactionHashVariant,
  captureScript: proof.captureScript,
  readbackFile: "deployments/studionet/qualification-v7/canonical-readback.json",
  readCount: proof.readCount,
  writeCount: proof.writeCount,
  canonicalQualificationState: proof.canonicalQualificationState,
  externalSettlementStatus: proof.externalSettlementStatus,
}, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  CANONICAL_PROOF_CAPTURE: "PASS",
  NETWORK: proof.network,
  CHAIN_ID: proof.chainId,
  LATEST_FINAL_ONLY: true,
  CANONICAL_PROOF_READ_COUNT: proof.readCount,
  CANONICAL_PROOF_WRITE_COUNT: proof.writeCount,
  MANDATE_IDS: proof.mandateIds,
  INTENT_IDS: proof.intentIds,
  OUTPUT: "deployments/studionet/qualification-v7/canonical-readback.json",
}, null, 2));
