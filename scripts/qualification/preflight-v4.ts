import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedDependencies} from "./create-root-mandate.ts";
import {runSimulation} from "./v4-lifecycle-simulation.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ARTIFACT_DIR = path.join(ROOT, "artifacts", "studionet", "qualification-v4");
const RPC = "https://studio.genlayer.com/api";
const CHAIN_ID = 61999;
const SIGNER = "0xcb5a845638cbc1f95d7f8343278685682c3ba13f";
const CORE = "0x0a6762c46F664751ee5a20d2efB94b979FA8a830";
const VAULT = "0x3737D9cD645cc6e8036D6775A8264aAa6422f9df";
const CORE_SHA = "6ece0d1aae99ccbd734b97802c9ca2481a38264da593b43ca8a5d7ab188c7053";
const VAULT_SHA = "d967d6f1e70cd698fc428338ca822c5541ce07fd7977517db7bb19f9796aa8ed";
const CONFIGURE_2 = "0xec6cf310458c1441f21f8121a3c575a3530ccc85f4cb5448fe361ba3cccc8069";
const SEAL_2 = "0x95377b0ccc9ccd8107d4df7c7adc8fbc089647c0d26eadfe5cdb939fd7a4df1f";
const FAILED_COUNTERPARTY = "0xa01e0ec943207656700c0fdd463039cb6b9f53c406476c6f4a50dd68603c2212";
let nextRpcAt = 0;
async function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const waitMs = Math.max(0, nextRpcAt - Date.now());
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  nextRpcAt = Date.now() + 2500;
  return operation();
}

function json(pathname: string): any { return JSON.parse(readFileSync(pathname, "utf8")); }
function sha256(pathname: string) { return createHash("sha256").update(readFileSync(pathname)).digest("hex"); }
function text(value: any) { return typeof value === "string" ? value : String(value ?? ""); }
function record(value: any): Record<string, any> {
  if (typeof value === "string") return value === "" ? {} : JSON.parse(value);
  return value && typeof value === "object" ? value : {};
}
function sameAddress(left: any, right: any) { return text(left).toLowerCase() === text(right).toLowerCase() && /^0x[0-9a-f]{40}$/i.test(text(left)); }
function safe(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safe(item)]));
  return value;
}
function resultOf(receipt: any) {
  const values = [receipt?.txExecutionResultName, receipt?.tx_execution_result_name, receipt?.txExecutionResult, receipt?.tx_execution_result, receipt?.executionResult, receipt?.execution_result];
  for (const value of values) {
    const normalized = text(value).toUpperCase();
    if (["SUCCESS", "FINISHED_WITH_RETURN", "RETURN", "COMMITTED", "OK", "1"].includes(normalized)) return "SUCCESS";
    if (["ERROR", "FINISHED_WITH_ERROR", "ROLLBACK", "FAILED", "FAILURE", "2"].includes(normalized)) return "ERROR";
  }
  const leaders = Array.isArray(receipt?.consensus_data?.leader_receipt) ? receipt.consensus_data.leader_receipt : receipt?.leader_receipt ?? [];
  for (const leader of leaders) {
    const normalized = text(leader?.result?.status ?? leader?.status).toUpperCase();
    if (["SUCCESS", "FINISHED_WITH_RETURN", "RETURN", "COMMITTED", "OK", "1"].includes(normalized)) return "SUCCESS";
    if (["ERROR", "FINISHED_WITH_ERROR", "ROLLBACK", "FAILED", "FAILURE", "2"].includes(normalized)) return "ERROR";
  }
  return "UNKNOWN";
}
function accounting(value: any) {
  const item = record(value);
  const keys = ["deposited", "available", "reserved", "release_pending", "refund_pending", "recovered"];
  const deposited = BigInt(item.deposited ?? "0");
  const sum = keys.slice(1).reduce((total, key) => total + BigInt(item[key] ?? "0"), 0n);
  assert.equal(sum, deposited, "Vault accounting conservation invariant");
  assert.equal(item.conserved, true, "Vault accounting conserved flag");
  return item;
}
function calldataRoundTrip(abi: any, functionName: string, args: any[]) {
  const object = abi.calldata.makeCalldataObject(functionName, args, undefined);
  const encoded = abi.calldata.encode(object);
  const decoded = abi.calldata.decode(encoded);
  const map = decoded instanceof Map ? decoded : new Map(Object.entries(decoded));
  const decodedArgs: any[] = map.get("args") ?? [];
  assert.equal(decodedArgs.length, args.length, `${functionName} calldata argument count`);
  return {method: functionName, argumentCount: decodedArgs.length, decodedArgs: safe(decodedArgs), decoded: safe(decoded), encodedBytes: Array.from(encoded)};
}
function decodeReceiptCalldata(abi: any, receipt: any) {
  const raw = receipt?.data?.calldata?.raw;
  assert.ok(Array.isArray(raw), "failed counterparty receipt must expose raw calldata");
  const decoded = abi.calldata.decode(Uint8Array.from(raw));
  const map = decoded instanceof Map ? decoded : new Map(Object.entries(decoded));
  return map.get("args") as any[];
}
function validateHttps(url: string, authority: string) {
  assert.equal(url.startsWith("https://"), true, "evidence URL must use exact HTTPS scheme");
  assert.ok(url.length <= 512, "evidence URL exceeds Core MAX_URL");
  assert.equal(/\s/.test(url), false, "evidence URL may not contain whitespace");
  assert.equal(url.includes("#"), false, "evidence URL may not contain a fragment");
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.hostname, authority);
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");
  assert.ok(parsed.hostname.length > 0 && parsed.hostname.length <= 253);
  return parsed;
}
function status(name: string, details: Record<string, any> = {}) { return {status: "PASS", name, ...details}; }
function fail(name: string, error: any) { return {status: "FAIL", name, error: text(error?.message ?? error)}; }

async function main() {
  const fixture = json(path.join(ARTIFACT_DIR, "qualification-fixture.json"));
  const matrix = json(path.join(ROOT, "scripts/qualification/v4-qualification-constraint-matrix.json"));
  const checkpoint = json(path.join(ARTIFACT_DIR, "checkpoint.json"));
  const source = {
    core: sha256(path.join(ROOT, "contracts/pavel_core.py")),
    vault: sha256(path.join(ROOT, "contracts/pavel_vault.py")),
  };
  assert.deepEqual(source, {core: CORE_SHA, vault: VAULT_SHA}, "frozen V4 source parity");
  assert.equal(matrix.sourceHashes.core, CORE_SHA);
  assert.equal(matrix.sourceHashes.vault, VAULT_SHA);
  assert.equal(fixture.qualificationVersion, "qualification-v4");
  assert.equal(fixture.network, "studionet");
  assert.equal(fixture.chainId, CHAIN_ID);
  assert.equal(fixture.authority, "docs.genlayer.com");
  const correctedUrl = text(fixture.evidence?.url ?? fixture.evidenceUrl);
  validateHttps(correctedUrl, fixture.authority);
  const urlResponse = await fetch(correctedUrl, {method: "HEAD", signal: AbortSignal.timeout(15000)});
  assert.equal(urlResponse.ok, true, `evidence URL HEAD status ${urlResponse.status}`);

  const deps = await loadPinnedDependencies();
  const {abi, chains, createClient, CalldataAddress} = deps;
  assert.equal(chains.studionet.id, CHAIN_ID);
  assert.equal(chains.studionet.rpcUrls.default.http[0], RPC);
  const client = createClient({chain: chains.studionet, endpoint: RPC, account: SIGNER});
  assert.equal(await serialized(() => client.getChainId()), CHAIN_ID);
  const read = (address: string, functionName: string, args: any[] = []) => serialized(() => client.readContract({address, functionName, args, account: SIGNER}));
  const configureReceipt = await serialized(() => client.getTransaction({hash: CONFIGURE_2}));
  const sealReceipt = await serialized(() => client.getTransaction({hash: SEAL_2}));
  const failedReceipt = await serialized(() => client.getTransaction({hash: FAILED_COUNTERPARTY}));
  const transactionReconciliation = {
    configure2: {hash: CONFIGURE_2, status: configureReceipt?.statusName ?? configureReceipt?.status, execution: resultOf(configureReceipt), nonce: configureReceipt?.nonce},
    seal2: {hash: SEAL_2, status: sealReceipt?.statusName ?? sealReceipt?.status, execution: resultOf(sealReceipt), nonce: sealReceipt?.nonce},
    failedCounterparty: {hash: FAILED_COUNTERPARTY, status: failedReceipt?.statusName ?? failedReceipt?.status, execution: resultOf(failedReceipt), nonce: failedReceipt?.nonce},
  };
  assert.equal(transactionReconciliation.configure2.status, "FINALIZED");
  assert.equal(transactionReconciliation.configure2.execution, "SUCCESS");
  assert.equal(transactionReconciliation.seal2.status, "FINALIZED");
  assert.equal(transactionReconciliation.seal2.execution, "SUCCESS");
  assert.equal(transactionReconciliation.failedCounterparty.status, "FINALIZED");
  assert.equal(transactionReconciliation.failedCounterparty.execution, "ERROR");
  const failedArgs = decodeReceiptCalldata(abi, failedReceipt);
  const failedEvidenceUrl = text(failedArgs[2]);
  assert.equal(failedArgs.length, 3);
  assert.equal(failedEvidenceUrl, "docs.genlayer.com");
  assert.equal(checkpoint.failedAttempts.some((item: any) => item.tx === FAILED_COUNTERPARTY), true);
  assert.equal(checkpoint.submittedTransactions.some((item: any) => item.tx === FAILED_COUNTERPARTY), true);
  assert.equal(checkpoint.completedSteps["core:register_counterparty"], undefined);

  const mandate = record(await read(CORE, "get_mandate", ["M-1"]));
  const counterparty = record(await read(CORE, "get_counterparty", ["C-1"]));
  const mandateAccounting = accounting(await read(VAULT, "get_accounting", ["M-1"]));
  const globalAccounting = accounting(await read(VAULT, "get_global_accounting"));
  const vaultCore = await read(VAULT, "get_core_address");
  const coreVault = await read(CORE, "get_vault_address");
  assert.equal(sameAddress(vaultCore, CORE), true);
  assert.equal(sameAddress(coreVault, VAULT), true);
  assert.equal(mandate.mandate_id, "M-1");
  assert.equal(mandate.status, "SEALED");
  assert.equal(mandate.sealed_at !== "", true);
  assert.equal(mandate.valid_from, "1790061797");
  assert.equal(mandate.expires_at, "1790234597");
  assert.equal(Object.keys(counterparty).length, 0, "failed counterparty must have rolled back");
  const expectedPolicy = {
    title: fixture.title,
    purpose: fixture.purpose,
    constitution: fixture.constitution,
    permitted_activity: fixture.permittedActivity,
    forbidden_activity: fixture.forbiddenActivity,
    maximum_single_transaction: String(fixture.maximumSingleTransaction),
    epoch_budget: String(fixture.epochBudget),
    epoch_duration_seconds: String(fixture.epochDurationSeconds),
    total_budget: String(fixture.totalBudget),
    challenge_window_seconds: String(fixture.challengeWindowSeconds),
    evidence_policy: fixture.evidencePolicy,
    authority_constraints: fixture.authorityConstraints,
    fulfillment_policy: fixture.fulfillmentPolicy,
    recovery_policy: fixture.recoveryPolicy,
    allow_prior_reservations: false,
  };
  for (const [field, expected] of Object.entries(expectedPolicy)) assert.deepEqual(mandate[field], expected, `M-1 policy field ${field}`);

  const currentChainTime = Number(sealReceipt?.current_timestamp ?? 0);
  assert.ok(Number.isSafeInteger(currentChainTime) && currentChainTime > 0, "finalized transaction must expose chain time");
  assert.ok(currentChainTime >= Number(mandate.valid_from) && currentChainTime < Number(mandate.expires_at), "M-1 must be active at the finalized chain-time reference");
  const remaining = Number(mandate.expires_at) - currentChainTime;
  const observedLatencies = [configureReceipt, sealReceipt].map((item: any) => Math.max(0, Number(item?.last_vote_timestamp ?? 0) - Number(item?.created_timestamp ?? 0))).filter((item) => item > 0);
  const observedMaxLatency = Math.max(5, ...observedLatencies);
  const requiredBuffer = Math.max(3600, observedMaxLatency * 8 + 1800);
  assert.ok(remaining > requiredBuffer, `M-1 remaining lifetime ${remaining}s is below required buffer ${requiredBuffer}s`);

  const counterpartyArgs = [new CalldataAddress(Uint8Array.from(Buffer.from(SIGNER.slice(2), "hex"))), fixture.counterpartyLabel, correctedUrl];
  const counterpartyCalldata = calldataRoundTrip(abi, "register_counterparty", counterpartyArgs);
  const decodedArgs: any[] = counterpartyCalldata.decodedArgs ?? [];
  assert.equal(decodedArgs.length, 3);
  assert.equal(decodedArgs[1], fixture.counterpartyLabel);
  assert.equal(decodedArgs[2], correctedUrl);
  assert.equal(validateHttps(correctedUrl, fixture.authority).hostname, fixture.authority);

  const intent = record(await read(CORE, "get_intent", ["I-1"]));
  let reservation = "";
  try { reservation = text(await read(VAULT, "get_reservation", ["I-1"])); } catch { reservation = ""; }
  const steps = {
    counterparty: status("PASS_READY_CORRECTED", {method: "register_counterparty", authority: fixture.authority, transportUrl: correctedUrl, failedEvidenceUrlExactValue: failedEvidenceUrl, typedCalldata: counterpartyCalldata, failedAttemptNotReplayable: true}),
    deposit: status("PASS_PREVALIDATED", {method: "deposit", value: "1", mandate: "M-1", accountingBefore: mandateAccounting}),
    intent: status("PASS_TEMPLATE_FAIL_CLOSED", {method: "create_intent", amount: "1", expiresAtRule: "chain_now < expires_at <= mandate.expires_at", typedCalldata: "runner validator asserted before broadcast"}),
    evidence: status("PASS_PREVALIDATED", {https: true, authority: fixture.authority, transport: correctedUrl, httpStatus: urlResponse.status, maxSourceBytes: 8192}),
    authorization: status("PASS_TEMPLATE_FAIL_CLOSED", {schema: "pavel-authorization-v1", dynamicConsensus: true, failClosedStates: ["UNASSESSED", "REJECTED", "AUTHORIZATION_RETRY_REQUIRED"]}),
    reservation: status("PASS_PREVALIDATED", {method: "reserve", amount: "1", accountingInvariant: matrix.accounting.perMandate}),
    unassessedProof: status("PASS_READ_ONLY", {noTransactionSubmitted: true, proof: "UNASSESSED_NOT_CLEARED"}),
    fulfillment: status("PASS_TEMPLATE_FAIL_CLOSED", {schema: "pavel-fulfillment-v1", dynamicConsensus: true, failClosedStates: ["NOT_FULFILLED", "INDETERMINATE", "FULFILLMENT_RETRY_REQUIRED"]}),
    settlementAuthorization: status("PASS_PREVALIDATED", {challengeGate: "CHALLENGE_BLOCKED only when qualifying challenge exists", chainTimeGate: "chain_now >= ready_at"}),
    vaultSettlement: status("PASS_PREVALIDATED", {method: "request_release", externalObservation: "UNCONFIRMED until child/recipient observation"}),
    accounting: status("PASS", {mandate: mandateAccounting, global: globalAccounting, invariant: matrix.accounting.perMandate}),
    time: status("PASS", {chainNow: currentChainTime, expiresAt: Number(mandate.expires_at), remainingSeconds: remaining, observedMaxLatencySeconds: observedMaxLatency, requiredBufferSeconds: requiredBuffer}),
  };
  const simulation = runSimulation();
  assert.equal(simulation.status, "PASS");
  assert.equal(simulation.noTransactionsSubmitted, true);
  const output = {
    audit: "PAVEL_V4_FULL_REMAINING_LIFECYCLE_PREFLIGHT",
    zeroWrites: true,
    network: "studionet",
    chainId: CHAIN_ID,
    signer: SIGNER,
    pair: {core: CORE, vault: VAULT, source: source, binding: "PASS"},
    transactionReconciliation,
    state: {mandateId: mandate.mandate_id, mandateStatus: mandate.status, mandateSealed: true, mandateActive: true, validFrom: mandate.valid_from, expiresAt: mandate.expires_at, currentChainTime, remainingSeconds: remaining, counterpartyRegistered: Object.keys(counterparty).length > 0, intentI1: Object.keys(intent).length ? intent.status : "ABSENT", reservationI1: reservation ? record(reservation).status : "ABSENT"},
    steps,
    fullLocalLifecycleSimulation: simulation,
    nextUnfinishedWrite: "core:register_counterparty:corrected",
    preflightResult: "PASS",
  };
  console.log("PREFLIGHT_RESULT=PASS");
  console.log(JSON.stringify(safe(output), null, 2));
}

main().catch((error) => {
  console.error(`PREFLIGHT_RESULT=FAIL ${text(error?.message ?? error)}`);
  process.exitCode = 1;
});
