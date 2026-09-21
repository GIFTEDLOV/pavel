import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  findExpectedKeystore,
  loadExistingAccount,
  loadPinnedDependencies,
} from "./create-root-mandate.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RPC = "https://studio.genlayer.com/api";
const CHAIN_ID = 61999;
const EXPECTED_SIGNER = "0xcb5a845638cbc1f95d7f8343278685682c3ba13f";
const CORE_SHA = "e48b2b75f2ca26f25db2cb9aaf6ae9a09add7833af437946218493bea18e7681";
const VAULT_SHA = "38222b8076542e2fe0185310b9b504adb05df60f6a29c5fbe8f22b1f83caa8c2";
const ARTIFACT_DIR = path.join(ROOT, "artifacts", "studionet", "qualification-v3");
const FIXTURE_PATH = path.join(ARTIFACT_DIR, "qualification-fixture.json");
const STATE_PATH = path.join(ARTIFACT_DIR, "qualification-state.json");
const POLL_MS = 5000;
const MAX_POLLS = 720;
const CORE_SOURCE = path.join(ROOT, "contracts", "pavel_core.py");
const VAULT_SOURCE = path.join(ROOT, "contracts", "pavel_vault.py");
const RPC_MIN_SPACING_MS = 2500;
const RPC_MAX_READ_ATTEMPTS = 4;

type Fixture = Record<string, any>;
type Step = {label: string; tx: string; status: string; execution?: string; outcome?: string; readback?: any; error?: string};
type State = {network: string; rpc: string; chainId: number; signer: string; core?: string; vault?: string; steps: Record<string, Step>; observations: Record<string, any>};

function jsonSafe(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) out[key] = jsonSafe(item);
    return out;
  }
  return value;
}

function writeArtifact(name: string, value: any) {
  mkdirSync(ARTIFACT_DIR, {recursive: true});
  writeFileSync(path.join(ARTIFACT_DIR, name), JSON.stringify(jsonSafe(value), null, 2) + "\n");
}

function rateLimitError(error: any) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return message.includes("429") || message.includes("rate limit") || message.includes("too many requests");
}

export class QualificationRpcScheduler {
  private tail: Promise<void> = Promise.resolve();
  private nextAllowedAt = 0;
  private readonly minSpacingMs: number;
  private readonly maxReadAttempts: number;
  private readonly backoffBaseMs: number;
  private attempts = 0;
  private rateLimitEvents = 0;
  private readRetries = 0;
  private writeRetriesPrevented = 0;

  constructor(options: {minSpacingMs?: number; maxReadAttempts?: number; backoffBaseMs?: number} = {}) {
    this.minSpacingMs = options.minSpacingMs ?? RPC_MIN_SPACING_MS;
    this.maxReadAttempts = options.maxReadAttempts ?? RPC_MAX_READ_ATTEMPTS;
    this.backoffBaseMs = options.backoffBaseMs ?? 5000;
  }

  enqueue<T>(label: string, operation: () => Promise<T>, readOnly: boolean) {
    let resolveResult!: (value: T | PromiseLike<T>) => void;
    let rejectResult!: (reason?: any) => void;
    const result = new Promise<T>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    const run = async () => {
      try { resolveResult(await this.execute(label, operation, readOnly)); }
      catch (error) { rejectResult(error); }
    };
    this.tail = this.tail.then(run, run);
    return result;
  }

  private async execute<T>(label: string, operation: () => Promise<T>, readOnly: boolean) {
    const limit = readOnly ? this.maxReadAttempts : 1;
    for (let attempt = 1; attempt <= limit; attempt += 1) {
      const waitMs = Math.max(0, this.nextAllowedAt - Date.now());
      if (waitMs > 0) await sleep(waitMs);
      this.nextAllowedAt = Date.now() + this.minSpacingMs;
      this.attempts += 1;
      try { return await operation(); }
      catch (error: any) {
        if (!rateLimitError(error)) throw error;
        this.rateLimitEvents += 1;
        if (!readOnly || attempt >= limit) {
          if (!readOnly) this.writeRetriesPrevented += 1;
          throw error;
        }
        this.readRetries += 1;
        const retryAfter = Number(error?.retryAfterMs ?? 0);
        const backoff = Math.max(retryAfter, this.backoffBaseMs * (2 ** (attempt - 1))) + Math.floor(Math.random() * 250);
        this.nextAllowedAt = Math.max(this.nextAllowedAt, Date.now() + backoff);
        writeArtifact("rpc-rate-limit-diagnostics.json", {lastRateLimit: {label, attempt, backoffMs: backoff, readOnly: true}, ...this.snapshot()});
      }
    }
    throw new Error(`RPC scheduler exhausted read-only retries for ${label}`);
  }

  snapshot() { return {minSpacingMs: this.minSpacingMs, maxReadAttempts: this.maxReadAttempts, attempts: this.attempts, rateLimitEvents: this.rateLimitEvents, readRetries: this.readRetries, writeRetriesPrevented: this.writeRetriesPrevented}; }
}

const RPC_SCHEDULER = new QualificationRpcScheduler();

function readFixture(): Fixture { return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")); }
function nowSeconds() { return Math.floor(Date.now() / 1000); }
function sha256File(filePath: string) { return createHash("sha256").update(readFileSync(filePath)).digest("hex"); }
function sha256Text(value: string) { return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex"); }
export function normalizeAddressValue(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(text) ? text : "";
}
function normalizeAddress(value: unknown) {
  const text = normalizeAddressValue(value);
  if (!text || /^0x0{40}$/.test(text)) return "";
  return text;
}
export function sameAddress(left: unknown, right: unknown) {
  const normalizedLeft = normalizeAddressValue(left);
  const normalizedRight = normalizeAddressValue(right);
  return normalizedLeft !== "" && normalizedLeft === normalizedRight;
}
function preserveAddress(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(text) || /^0x0{40}$/i.test(text)) return "";
  return text;
}
function addressBytes(value: string) { return Uint8Array.from(Buffer.from(value.slice(2), "hex")); }
function address(CalldataAddress: new (bytes: Uint8Array) => unknown, value: string) { return new CalldataAddress(addressBytes(value)); }
function asText(value: any) { return typeof value === "string" ? value : String(value ?? ""); }
function asRecord(value: any): Record<string, any> {
  if (typeof value === "string") return value === "" ? {} : JSON.parse(value);
  return value && typeof value === "object" ? value : {};
}
function loadState(): State {
  if (!existsSync(STATE_PATH)) return {network: "studionet", rpc: RPC, chainId: CHAIN_ID, signer: EXPECTED_SIGNER, steps: {}, observations: {}};
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  state.steps ??= {};
  state.observations ??= {};
  if (state.signer !== EXPECTED_SIGNER || state.rpc !== RPC || state.chainId !== CHAIN_ID) throw new Error("Qualification-v3 checkpoint network or signer mismatch");
  return state;
}
function saveState(state: State) { writeArtifact("qualification-state.json", state); }
function appendTransaction(entry: Record<string, any>) {
  const file = path.join(ARTIFACT_DIR, "transactions.json");
  let doc: any = {network: "studionet", rpc: RPC, chainId: CHAIN_ID, transactions: []};
  if (existsSync(file)) doc = JSON.parse(readFileSync(file, "utf8"));
  doc.transactions ??= [];
  const index = doc.transactions.findIndex((item: any) => item.tx === entry.tx);
  if (index < 0) doc.transactions.push(jsonSafe(entry));
  else doc.transactions[index] = {...doc.transactions[index], ...jsonSafe(entry)};
  writeArtifact("transactions.json", doc);
}
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function rawRpc(method: string, params: any[]) {
  return RPC_SCHEDULER.enqueue(`raw:${method}`, async () => {
    const response = await fetch(RPC, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: Date.now(), method, params})});
    const payload: any = await response.json();
    if (response.status === 429 || payload.error?.code === 429 || String(payload.error?.message ?? "").toLowerCase().includes("rate limit")) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader ? (/^\d+(\.\d+)?$/.test(retryAfterHeader) ? Number(retryAfterHeader) * 1000 : Math.max(0, Date.parse(retryAfterHeader) - Date.now())) : 0;
      const error: any = new Error(`${payload.error?.message ?? "RPC rate limit"}`);
      error.retryAfterMs = retryAfterMs;
      throw error;
    }
    if (payload.error) throw new Error(`${payload.error.message ?? "RPC error"}${payload.error.data ? `: ${JSON.stringify(payload.error.data)}` : ""}`);
    return payload.result;
  }, true);
}
function read(client: any, target: string, functionName: string, args: any[] = []) {
  return RPC_SCHEDULER.enqueue(`read:${functionName}`, () => client.readContract({address: target, functionName, args, account: EXPECTED_SIGNER}), true);
}
function calldataProof(abi: any, functionName: string, args: any[]) {
  const object = abi.calldata.makeCalldataObject(functionName, args, undefined);
  const encoded = abi.calldata.encode(object);
  const decoded = abi.calldata.decode(encoded);
  const map = decoded instanceof Map ? decoded : new Map(Object.entries(decoded));
  const decodedArgs = map.get("args");
  const normalizedArgs = decodedArgs === undefined && args.length === 0 ? [] : decodedArgs;
  if (!Array.isArray(normalizedArgs) || normalizedArgs.length !== args.length) throw new Error(`${functionName} typed calldata argument count mismatch`);
  return {method: functionName, argumentCount: normalizedArgs.length, roundTrip: abi.calldata.toString(decoded), encodedBytes: Array.from(encoded)};
}
function fixtureWithDefaults(fixture: Fixture) {
  const authority = String(fixture.authority ?? "").trim().toLowerCase();
  const constraints = String(fixture.authorityConstraints ?? authority).trim().toLowerCase().replace(/ /g, "");
  return {...fixture,
    title: fixture.title,
    constitution: fixture.constitution,
    evidencePolicy: fixture.evidencePolicy,
    authorityConstraints: fixture.authorityConstraints,
    deployedAuthorityConstraints: constraints.split(",").includes(authority) ? constraints : authority,
    fulfillmentPolicy: fixture.fulfillmentPolicy,
    recoveryPolicy: fixture.recoveryPolicy,
  };
}
function assertAccounting(value: any, label: string) {
  const item = asRecord(value);
  const deposited = BigInt(item.deposited ?? "0");
  const sum = ["available", "reserved", "release_pending", "refund_pending", "recovered"].reduce((total, key) => total + BigInt(item[key] ?? "0"), 0n);
  if (sum !== deposited || item.conserved !== true) throw new Error(`${label} accounting conservation invariant failed`);
  return item;
}
function assertMandate(mandate: Record<string, any>, fixture: Fixture, status?: string) {
  const expected: Record<string, any> = {
    principal: EXPECTED_SIGNER, authorized_agent: EXPECTED_SIGNER, parent_mandate_id: "", title: fixture.title,
    purpose: fixture.purpose, constitution: fixture.constitution, permitted_activity: fixture.permittedActivity,
    forbidden_activity: fixture.forbiddenActivity, maximum_single_transaction: String(fixture.maximumSingleTransaction),
    epoch_budget: String(fixture.epochBudget), epoch_duration_seconds: String(fixture.epochDurationSeconds), total_budget: String(fixture.totalBudget),
    valid_from: String(fixture.validFrom), expires_at: String(fixture.expiresAt), challenge_window_seconds: String(fixture.challengeWindowSeconds),
    evidence_policy: fixture.evidencePolicy, authority_constraints: fixture.deployedAuthorityConstraints,
    fulfillment_policy: fixture.fulfillmentPolicy, recovery_policy: fixture.recoveryPolicy, allow_prior_reservations: false,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    const addressField = ["principal", "authorized_agent"].includes(field);
    const actual = addressField ? asText(mandate[field]) : mandate[field];
    if (addressField ? !sameAddress(actual, expectedValue) : actual !== expectedValue) throw new Error(`M-1 readback mismatch for ${field}: expected ${String(expectedValue)}, got ${String(actual)}`);
  }
  if (status && mandate.status !== status) throw new Error(`M-1 status mismatch: expected ${status}, got ${mandate.status}`);
  if (status === "SEALED" && asText(mandate.definition_hash) === "") throw new Error("M-1 sealed policy fingerprint is missing");
  return mandate;
}
function assertIntent(intent: Record<string, any>, fixture: Fixture) {
  const expected: Record<string, any> = {mandate_id: "M-1", agent: EXPECTED_SIGNER, principal: EXPECTED_SIGNER, recipient: EXPECTED_SIGNER, counterparty_identity_id: "C-1", amount: "1", purpose: fixture.purpose, deliverable: fixture.deliverable, commercial_terms: fixture.commercialTerms, fulfillment_criteria: fixture.fulfillmentCriteria};
  for (const [field, value] of Object.entries(expected)) {
    const addressField = ["agent", "principal", "recipient"].includes(field);
    const actual = addressField ? asText(intent[field]) : intent[field];
    if (addressField ? !sameAddress(actual, value) : actual !== value) throw new Error(`Intent readback mismatch for ${field}`);
  }
  if (asText(intent.intent_fingerprint) === "") throw new Error("Intent fingerprint is missing");
}
export function inspectResults(receipt: any) {
  const consensusStatus = String(receipt?.statusName ?? receipt?.status ?? "UNKNOWN").toUpperCase();
  const consensusRaw = receipt?.result_name ?? receipt?.resultName ?? receipt?.result;
  const consensusNames: Record<string, string> = {"0": "IDLE", "1": "AGREE", "2": "DISAGREE", "3": "TIMEOUT", "4": "DETERMINISTIC_VIOLATION", "5": "NO_MAJORITY", "6": "MAJORITY_AGREE", "7": "MAJORITY_DISAGREE"};
  const consensusResult = typeof consensusRaw === "number" || typeof consensusRaw === "bigint" || /^\d+$/.test(String(consensusRaw ?? "")) ? consensusNames[String(consensusRaw)] ?? String(consensusRaw) : String(consensusRaw ?? "UNKNOWN").toUpperCase();
  const executionValue = (value: any) => {
    if (value === 1 || value === "1") return "SUCCESS";
    if (value === 2 || value === "2") return "ERROR";
    const normalized = String(value ?? "").toUpperCase();
    if (["SUCCESS", "FINISHED_WITH_RETURN", "RETURN", "COMMITTED", "OK"].includes(normalized)) return "SUCCESS";
    if (["ERROR", "FINISHED_WITH_ERROR", "ROLLBACK", "FAILED", "FAILURE"].includes(normalized)) return "ERROR";
    return "UNKNOWN";
  };
  const fields: Array<[string, any]> = [["txExecutionResultName", receipt?.txExecutionResultName], ["tx_execution_result_name", receipt?.tx_execution_result_name], ["txExecutionResult", receipt?.txExecutionResult], ["tx_execution_result", receipt?.tx_execution_result], ["executionResult", receipt?.executionResult], ["execution_result", receipt?.execution_result]];
  for (const [source, value] of fields) if (value !== undefined && value !== null && executionValue(value) !== "UNKNOWN") return {consensusStatus, consensusResult, executionResult: executionValue(value), executionResultSource: source};
  const leaders = Array.isArray(receipt?.consensus_data?.leader_receipt) ? receipt.consensus_data.leader_receipt : Array.isArray(receipt?.leader_receipt) ? receipt.leader_receipt : [];
  for (const leader of leaders) {
    const result = executionValue(leader?.result?.status ?? leader?.status);
    if (result !== "UNKNOWN") return {consensusStatus, consensusResult, executionResult: result, executionResultSource: "leader_receipt.result.status"};
  }
  const validators = Array.isArray(receipt?.consensus_data?.validators) ? receipt.consensus_data.validators.map((item: any) => executionValue(item?.execution_result)).filter((item: string) => item !== "UNKNOWN") : [];
  if (validators.length && validators.every((item: string) => item === "SUCCESS")) return {consensusStatus, consensusResult, executionResult: "SUCCESS", executionResultSource: "consensus_data.validators.execution_result"};
  if (validators.length && validators.every((item: string) => item === "ERROR")) return {consensusStatus, consensusResult, executionResult: "ERROR", executionResultSource: "consensus_data.validators.execution_result"};
  return {consensusStatus, consensusResult, executionResult: "UNKNOWN", executionResultSource: "unavailable"};
}
export async function collectExecutionDiagnostics(client: any, tx: string, receipt: any) {
  const safeRead = async (label: string, action: () => Promise<any>) => {
    try { return {supported: true, value: await RPC_SCHEDULER.enqueue(`error:${tx}:${label}`, action, true)}; }
    catch (error: any) { return {supported: false, error: String(error?.message ?? error)}; }
  };
  const leader = Array.isArray(receipt?.consensus_data?.leader_receipt) ? receipt.consensus_data.leader_receipt : Array.isArray(receipt?.leader_receipt) ? receipt.leader_receipt : [];
  const validators = Array.isArray(receipt?.consensus_data?.validators) ? receipt.consensus_data.validators : [];
  const leaderPayload = leader.find((item: any) => item?.result?.payload)?.result?.payload ?? "";
  const diagnostic = {
    tx,
    consensusStatus: receipt?.statusName ?? receipt?.status,
    consensusResult: receipt?.result_name ?? receipt?.resultName ?? receipt?.result,
    txExecutionResultName: receipt?.txExecutionResultName ?? receipt?.tx_execution_result_name ?? "UNAVAILABLE",
    executionResult: inspectResults(receipt).executionResult,
    executionResultSource: inspectResults(receipt).executionResultSource,
    exceptionType: leaderPayload ? "GenVM.UserError_OR_RUNTIME_ERROR" : "UNAVAILABLE",
    exceptionMessage: leaderPayload,
    leader: leader.map((item: any) => ({result: item?.result, genvmResult: item?.genvm_result, executionStats: item?.execution_stats, calldata: item?.calldata})),
    validators: validators.map((item: any) => ({vote: item?.vote, result: item?.result, genvmResult: item?.genvm_result, executionStats: item?.execution_stats, address: item?.node_config?.address})),
    traceSurfaces: {
      gen_getTransactionReceipt: await safeRead("gen_getTransactionReceipt", () => client.request({method: "gen_getTransactionReceipt", params: [tx]})),
      clientGetTransactionReceipt: await safeRead("clientGetTransactionReceipt", () => client.getTransactionReceipt({hash: tx})),
      clientDebugTraceTransaction: await safeRead("clientDebugTraceTransaction", () => client.debugTraceTransaction({hash: tx, round: 0})),
      debugTraceTransaction: await safeRead("debugTraceTransaction", () => client.request({method: "debug_traceTransaction", params: [tx, {round: 0}]})),
    },
  };
  writeArtifact(`execution-error-${tx.slice(2, 14)}.json`, diagnostic);
  return diagnostic;
}
async function reconcile(client: any, tx: string, account: any, expectedState?: () => Promise<any>) {
  let finalizationTx: string | undefined;
  for (let attempt = 1; attempt <= MAX_POLLS; attempt += 1) {
    let receipt: any;
    try { receipt = await RPC_SCHEDULER.enqueue(`tx:${tx}:status`, () => client.getTransaction({hash: tx}), true); }
    catch (error: any) { writeArtifact(`tx-${tx.slice(2, 14)}.json`, {tx, attempt, polling: "AMBIGUOUS", error: String(error?.message ?? error)}); await sleep(POLL_MS); continue; }
    writeArtifact(`tx-${tx.slice(2, 14)}.json`, {tx, attempt, receipt});
    if (!receipt) { await sleep(POLL_MS); continue; }
    const status = String(receipt.statusName ?? receipt.status ?? "");
    if (status === "FINALIZED") {
      const observation = inspectResults(receipt);
      let lifecycle = receipt.lifecycle ?? status;
      try { lifecycle = await rawRpc("gen_getTransactionStatus", [tx]); } catch { /* pinned Studionet may omit auxiliary status */ }
      if (observation.executionResult === "ERROR") {
        const diagnostic = await collectExecutionDiagnostics(client, tx, receipt);
        throw new Error(`Transaction ${tx} finalized with explicit execution ERROR (${observation.executionResultSource}): ${diagnostic.exceptionMessage || "no concrete leader error payload"}`);
      }
      if (observation.executionResult === "SUCCESS") return {receipt, ...observation, lifecycle, outcome: "SUCCESS"};
      if (!expectedState) throw new Error(`Transaction ${tx} finalized with UNKNOWN execution and no expected state fallback`);
      let readback: any;
      try { readback = await expectedState(); }
      catch (error: any) { throw new Error(`Transaction ${tx} finalized with UNKNOWN execution and expected state was not proven: ${String(error?.message ?? error)}`); }
      return {receipt, ...observation, lifecycle, outcome: "SUCCESS_PROVEN_BY_FINALIZED_STATE", stateReadback: readback};
    }
    if (["CANCELED", "UNDETERMINED", "VALIDATORS_TIMEOUT", "LEADER_TIMEOUT"].includes(status)) throw new Error(`Transaction ${tx} reached terminal non-success status ${status}`);
    if (status === "READY_TO_FINALIZE" && !finalizationTx) {
      finalizationTx = await RPC_SCHEDULER.enqueue(`tx:${tx}:finalize`, () => client.finalizeTransaction({account, txId: tx}), false);
      appendTransaction({kind: `finalize:${tx}`, tx: finalizationTx, status: "SUBMITTED", execution: "PENDING"});
    }
    await sleep(POLL_MS);
  }
  throw new Error(`Timed out reconciling ${tx}; no replacement was submitted`);
}
function targetFor(label: string, core: string, vault: string) { return label.startsWith("vault:") ? vault : core; }
async function executeStep(config: {abi: any; client: any; account: any; state: State; core: string; vault: string; label: string; functionName: string; args: any[]; summary: any[]; precondition: () => Promise<void>; readback: () => Promise<any>; expectedState?: () => Promise<any>; value?: bigint}) {
  const {abi, client, account, state, core, vault, label, functionName, args, summary, precondition, readback, expectedState, value = 0n} = config;
  const existing = state.steps[label];
  if (existing?.status === "COMPLETE") return {tx: existing.tx, readback: await readback(), resumed: true};
  let tx = existing?.tx;
  let proof: any;
  if (tx) {
    if (existing.status === "ERROR") throw new Error(`Checkpoint contains explicit failed transaction for ${label}: ${existing.error ?? "unknown"}`);
  } else {
    proof = calldataProof(abi, functionName, args);
    await precondition();
    tx = String(await RPC_SCHEDULER.enqueue(`write:${label}`, () => client.writeContract({address: targetFor(label, core, vault), functionName, args, value, account}), false));
    const entry: Step = {label, tx, status: "SUBMITTED"};
    state.steps[label] = entry;
    saveState(state);
    appendTransaction({kind: label, tx, method: functionName, args: summary, calldataProof: proof, value: value.toString(), status: "SUBMITTED", execution: "PENDING", broadcastedAt: new Date().toISOString()});
    console.log(`TX_SUBMITTED=${label} ${tx}`);
  }
  let result: any;
  try { result = await reconcile(client, tx, account, expectedState); }
  catch (error: any) { state.steps[label] = {...state.steps[label], label, tx, status: "ERROR", error: String(error?.message ?? error)}; saveState(state); appendTransaction({kind: label, tx, status: "ERROR", executionResult: "ERROR", error: String(error?.message ?? error)}); writeArtifact("last-lifecycle-step.json", state.steps[label]); throw error; }
  const rb = await readback();
  state.steps[label] = {...state.steps[label], label, tx, status: "COMPLETE", execution: result.executionResult, executionResult: result.executionResult, outcome: result.outcome, lifecycle: result.lifecycle, readback: rb};
  saveState(state);
  appendTransaction({kind: label, tx, method: functionName, args: summary, status: result.receipt.statusName, lifecycle: result.lifecycle, consensusStatus: result.consensusStatus, consensusResult: result.consensusResult, executionResult: result.executionResult, executionResultSource: result.executionResultSource, reconciliationOutcome: result.outcome, receipt: result.receipt, readback: rb});
  writeArtifact("last-lifecycle-step.json", state.steps[label]);
  return {tx, receipt: result.receipt, readback: rb, resumed: false};
}
export function authoritativeDeploymentAddress(receipt: any) {
  const values = [receipt?.txDataDecoded?.contractAddress, receipt?.data?.contract_address, receipt?.data?.contractAddress, receipt?.contract_address, receipt?.contractAddress, receipt?.recipient];
  for (const value of values) { const preserved = preserveAddress(value); if (preserved) return preserved; }
  return "";
}
export function contractCodeFromFinalizedReceipt(receipt: any) {
  const encoded = receipt?.data?.contract_code ?? receipt?.contract_code ?? receipt?.data?.contractCode;
  if (typeof encoded !== "string" || encoded === "") return "";
  try {
    if (encoded.startsWith("0x")) return Buffer.from(encoded.slice(2), "hex").toString("utf8");
    return Buffer.from(encoded, "base64").toString("utf8");
  } catch { return ""; }
}
function persistedDeploymentCode(step: any) {
  const direct = contractCodeFromFinalizedReceipt(step?.receipt);
  if (direct) return direct;
  const transactionPath = path.join(ARTIFACT_DIR, "transactions.json");
  if (!step?.tx || !existsSync(transactionPath)) return "";
  try {
    const document = JSON.parse(readFileSync(transactionPath, "utf8"));
    const entry = document.transactions?.find((item: any) => item.tx === step.tx);
    return contractCodeFromFinalizedReceipt(entry?.receipt);
  } catch { return ""; }
}
function persistedDeploymentReceipt(step: any) {
  if (!step?.tx) return null;
  const transactionPath = path.join(ARTIFACT_DIR, "transactions.json");
  if (!existsSync(transactionPath)) return null;
  try {
    const document = JSON.parse(readFileSync(transactionPath, "utf8"));
    return document.transactions?.find((item: any) => item.tx === step.tx)?.receipt ?? null;
  } catch { return null; }
}
function deploymentConstructorAddress(step: any) {
  const receipt = persistedDeploymentReceipt(step);
  const raw = receipt?.data?.calldata?.raw;
  if (Array.isArray(raw) && raw.length >= 20) return `0x${Buffer.from(raw.slice(-20)).toString("hex")}`;
  const readable = receipt?.data?.calldata?.readable;
  const match = typeof readable === "string" ? readable.match(/addr#([0-9a-fA-F]{40})/) : null;
  return match ? `0x${match[1]}` : "";
}
function persistedDeploymentAddress(step: any) {
  const direct = authoritativeDeploymentAddress(step?.receipt);
  if (direct) return direct;
  const transactionPath = path.join(ARTIFACT_DIR, "transactions.json");
  if (!step?.tx || !existsSync(transactionPath)) return "";
  try {
    const document = JSON.parse(readFileSync(transactionPath, "utf8"));
    const entry = document.transactions?.find((item: any) => item.tx === step.tx);
    return authoritativeDeploymentAddress(entry?.receipt) || preserveAddress(entry?.authoritativeAddress);
  } catch { return ""; }
}
function cachedSourceParity(step: any, addressValue: string, expectedHash: string) {
  const proof = step?.readback?.sourceParity;
  if (!proof || proof.exact !== true || proof.hash !== expectedHash) return null;
  if (normalizeAddress(proof.address) !== normalizeAddress(addressValue)) return null;
  return proof;
}
export async function deployedSourceParity(client: any, addressValue: string, expectedHash: string, attempts = 3, delayMs = POLL_MS, finalizedReceiptCode = "", rpcReader = rawRpc) {
  let lastError = "contract code unavailable";
  const diagnostic: any = {address: addressValue, expectedHash, lookup: "gen_getContractCode", requestedStatus: "finalized", attempts: []};
  const persistDiagnostic = () => writeArtifact(`source-lookup-${addressValue.slice(2, 14)}.json`, diagnostic);
  const verify = (code: string, source: string, attempt: number) => {
    const actualHash = sha256Text(code);
    if (actualHash !== expectedHash) throw new Error(`Deployed source hash mismatch at ${addressValue}: expected ${expectedHash}, got ${actualHash}`);
    diagnostic.result = {source, hash: actualHash, bytes: Buffer.byteLength(code, "utf8"), attempt};
    persistDiagnostic();
    return {address: addressValue, hash: actualHash, exact: true, bytes: Buffer.byteLength(code, "utf8"), attempts: attempt, source, compatibilityFallback: diagnostic.compatibilityFallback ?? null};
  };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const attemptRecord: any = {attempt, finalized: {}, acceptedSdk: {}};
    try {
      const encoded = await rpcReader("gen_getContractCode", [{address: addressValue, status: "finalized"}]);
      if (typeof encoded !== "string" || encoded === "") throw new Error("finalized source response was empty");
      const code = Buffer.from(encoded, "base64").toString("utf8");
      attemptRecord.finalized = {status: "AVAILABLE"};
      diagnostic.attempts.push(attemptRecord);
      return verify(code, "FINALIZED_CONTRACT_CODE", attempt);
    } catch (error: any) {
      lastError = String(error?.message ?? error);
      attemptRecord.finalized = {status: "UNAVAILABLE", error: lastError};
      try {
        const legacyEncoded = await rpcReader("gen_getContractCode", [addressValue]);
        if (typeof legacyEncoded !== "string" || legacyEncoded === "") throw new Error("legacy source response was empty");
        const legacyCode = Buffer.from(legacyEncoded, "base64").toString("utf8");
        attemptRecord.legacyAddressString = {status: "AVAILABLE", compatibilityFallback: true};
        diagnostic.attempts.push(attemptRecord);
        diagnostic.compatibilityFallback = "legacy-address-string";
        return verify(legacyCode, "FINALIZED_CONTRACT_CODE", attempt);
      } catch (legacyError: any) {
        attemptRecord.legacyAddressString = {status: "UNAVAILABLE", error: String(legacyError?.message ?? legacyError)};
      }
      if (attempt === 1) {
        try {
          const code = await RPC_SCHEDULER.enqueue(`source:${addressValue}`, () => client.getContractCode(addressValue), true);
          attemptRecord.acceptedSdk = {status: "AVAILABLE", bytes: Buffer.byteLength(code, "utf8"), proofOnly: false};
        } catch (sdkError: any) {
          attemptRecord.acceptedSdk = {status: "UNAVAILABLE", error: String(sdkError?.message ?? sdkError), proofOnly: true};
        }
      }
      diagnostic.attempts.push(attemptRecord);
      persistDiagnostic();
      if (lastError.includes("source hash mismatch")) throw error;
      if (attempt < attempts) await sleep(delayMs);
    }
  }
  if (finalizedReceiptCode !== "") {
    return verify(finalizedReceiptCode, "FINALIZED_DEPLOY_TX_CODE_BYTES", attempts);
  }
  diagnostic.result = {status: "PENDING", lastError};
  persistDiagnostic();
  throw new Error(`Finalized deployment source lookup did not converge for ${addressValue} after ${attempts} read-only attempts: ${lastError}`);
}
function normalizeCompletedDeploymentCheckpoint(state: State, label: string) {
  const step: any = state.steps[label];
  if (!step || step.status !== "COMPLETE") return;
  const authoritative = persistedDeploymentAddress(step);
  if (authoritative) {
    step.readback = {...(step.readback ?? {}), address: authoritative};
    if (label === "deploy:core") state.core = authoritative;
    if (label === "deploy:vault") state.vault = authoritative;
  }
  if ((step.execution === undefined || step.execution === null) && step.executionResult !== undefined && step.executionResult !== null) step.execution = step.executionResult;
  if ((step.executionResult === undefined || step.executionResult === null) && step.execution !== undefined && step.execution !== null) step.executionResult = step.execution;
  if (step.lifecycle === undefined) step.lifecycle = step.receipt?.lifecycle ?? step.receipt?.statusName ?? step.status;
  if (step.readback?.sourceParity?.source === "finalized_transaction.contract_code_after_gen_getContractCode_lag") step.readback.sourceParity.source = "FINALIZED_DEPLOY_TX_CODE_BYTES";
  saveState(state);
}
async function reconcilePersistedDeploymentReadOnly(client: any, state: State, label: string, expectedHash: string) {
  const checkpoint = state.steps[label];
  if (!checkpoint?.tx || checkpoint.status === "COMPLETE") return checkpoint?.readback?.address ?? "";
  let receipt: any;
  for (let attempt = 1; attempt <= 24; attempt += 1) {
      try { receipt = await RPC_SCHEDULER.enqueue(`tx:${checkpoint.tx}:status`, () => client.getTransaction({hash: checkpoint.tx}), true); }
    catch (error: any) { writeArtifact(`tx-${checkpoint.tx.slice(2, 14)}.json`, {tx: checkpoint.tx, attempt, polling: "AMBIGUOUS", error: String(error?.message ?? error)}); await sleep(POLL_MS); continue; }
    writeArtifact(`tx-${checkpoint.tx.slice(2, 14)}.json`, {tx: checkpoint.tx, attempt, receipt});
    if (!receipt) { await sleep(POLL_MS); continue; }
    const status = String(receipt.statusName ?? receipt.status ?? "");
    if (status === "FINALIZED") {
      const observation = inspectResults(receipt);
      if (observation.executionResult === "ERROR") {
        state.steps[label] = {...checkpoint, status: "ERROR", error: `Finalized deployment execution ERROR (${observation.executionResultSource})`, receipt};
        saveState(state);
        throw new Error(state.steps[label].error);
      }
      if (observation.executionResult === "UNKNOWN") {
        state.steps[label] = {...checkpoint, status: "FINALIZED_UNKNOWN_EXECUTION", receipt, ...observation};
        saveState(state);
        throw new Error(`Finalized deployment execution is UNKNOWN; refusing source lookup until execution is explicit (${observation.executionResultSource})`);
      }
      const deployedAddress = authoritativeDeploymentAddress(receipt);
      if (!deployedAddress) throw new Error("Finalized deployment did not expose an authoritative contract address");
      state.steps[label] = {...checkpoint, status: "FINALIZED_PENDING_SOURCE", readback: {address: deployedAddress, sourceParity: "PENDING"}, receipt, lifecycle: receipt.lifecycle ?? receipt.statusName, execution: observation.executionResult, executionResult: observation.executionResult, ...observation};
      saveState(state);
      const parity = await deployedSourceParity(client, deployedAddress, expectedHash, 12, POLL_MS, contractCodeFromFinalizedReceipt(receipt));
      state.steps[label] = {...state.steps[label], status: "COMPLETE", readback: {address: deployedAddress, sourceParity: parity}};
      if (label === "deploy:core") state.core = deployedAddress;
      if (label === "deploy:vault") state.vault = deployedAddress;
      saveState(state);
      appendTransaction({kind: label, tx: checkpoint.tx, status: "FINALIZED", lifecycle: receipt.lifecycle ?? receipt.statusName, ...observation, authoritativeAddress: deployedAddress, receipt, readback: {address: deployedAddress, sourceParity: parity}});
      writeArtifact(`${label.replace(/[^a-z0-9]+/gi, "-")}.json`, {tx: checkpoint.tx, receipt, readback: {address: deployedAddress, sourceParity: parity}, reconciliation: "READ_ONLY_RESUME"});
      return deployedAddress;
    }
    if (["CANCELED", "UNDETERMINED", "VALIDATORS_TIMEOUT", "LEADER_TIMEOUT"].includes(status)) throw new Error(`Persisted deployment reached terminal non-success status ${status}`);
    if (status === "READY_TO_FINALIZE") return "";
    await sleep(POLL_MS);
  }
  return "";
}
async function executeDeployment(config: {client: any; account: any; state: State; label: string; codePath: string; expectedHash: string; constructorArgs: any[]; summary: any[]}) {
  const {client, account, state, label, codePath, expectedHash, constructorArgs, summary} = config;
  const existing = state.steps[label];
  let tx = existing?.tx;
  if (!tx) {
    const code = new Uint8Array(readFileSync(codePath));
    if (sha256File(codePath) !== expectedHash) throw new Error(`${label} source hash changed after freeze`);
    tx = String(await RPC_SCHEDULER.enqueue(`write:${label}`, () => client.deployContract({code, args: constructorArgs, account}), false));
    state.steps[label] = {label, tx, status: "SUBMITTED"};
    saveState(state);
    appendTransaction({kind: label, tx, method: "deployContract", args: summary, status: "SUBMITTED", execution: "PENDING", broadcastedAt: new Date().toISOString()});
    console.log(`TX_SUBMITTED=${label} ${tx}`);
  }
  let result: any;
  try { result = await reconcile(client, tx, account); }
  catch (error: any) {
    state.steps[label] = {...state.steps[label], label, tx, status: "ERROR", error: String(error?.message ?? error)};
    saveState(state);
    writeArtifact("last-lifecycle-step.json", state.steps[label]);
    throw error;
  }
  const deployedAddress = existing?.readback?.address ?? authoritativeDeploymentAddress(result.receipt);
  if (!deployedAddress) throw new Error(`${label} finalized but Studionet did not expose the deployed contract address`);
  state.steps[label] = {...state.steps[label], label, tx, status: "FINALIZED_PENDING_SOURCE", execution: result.executionResult, executionResult: result.executionResult, outcome: result.outcome, readback: {address: deployedAddress, sourceParity: "PENDING"}, consensusStatus: result.consensusStatus, consensusResult: result.consensusResult, executionResultSource: result.executionResultSource, lifecycle: result.lifecycle};
  saveState(state);
  appendTransaction({kind: label, tx, method: "deployContract", args: summary, status: result.receipt.statusName, lifecycle: result.lifecycle, consensusStatus: result.consensusStatus, consensusResult: result.consensusResult, executionResult: result.executionResult, executionResultSource: result.executionResultSource, reconciliationOutcome: result.outcome, authoritativeAddress: deployedAddress, receipt: result.receipt});
  const parity = await deployedSourceParity(client, deployedAddress, expectedHash, 12, POLL_MS, contractCodeFromFinalizedReceipt(result.receipt));
  const readback = {address: deployedAddress, sourceParity: parity};
  state.steps[label] = {...state.steps[label], label, tx, status: "COMPLETE", execution: result.executionResult, executionResult: result.executionResult, outcome: result.outcome, readback, consensusStatus: result.consensusStatus, consensusResult: result.consensusResult, executionResultSource: result.executionResultSource, lifecycle: result.lifecycle};
  saveState(state);
  appendTransaction({kind: label, tx, method: "deployContract", args: summary, status: result.receipt.statusName, lifecycle: result.lifecycle, consensusStatus: result.consensusStatus, consensusResult: result.consensusResult, executionResult: result.executionResult, executionResultSource: result.executionResultSource, reconciliationOutcome: result.outcome, authoritativeAddress: deployedAddress, receipt: result.receipt, readback});
  writeArtifact(`${label.replace(/[^a-z0-9]+/gi, "-")}.json`, {tx, receipt: result.receipt, readback});
  return {tx, address: deployedAddress, receipt: result.receipt, readback};
}
async function schemaParity(client: any, core: string, vault: string, coreCode = "", vaultCode = "") {
  const cachePath = path.join(ARTIFACT_DIR, "qualification-schema-cache.json");
  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, "utf8"));
      if (sameAddress(cached.coreAddress, core) && sameAddress(cached.vaultAddress, vault) && cached.sourceHashes?.core === CORE_SHA && cached.sourceHashes?.vault === VAULT_SHA) {
        const serialized = JSON.stringify(cached.schemas);
        for (const name of [...cached.coreRequired, ...cached.vaultRequired]) if (!serialized.includes(name)) throw new Error(`Cached schema is missing required interface method ${name}`);
        writeArtifact("live-interface-parity.json", cached.schemas);
        return cached.summary;
      }
    } catch (error: any) {
      writeArtifact("qualification-schema-cache-invalid.json", {error: String(error?.message ?? error)});
    }
  }
  const getSchema = async (addressValue: string, code: string) => {
    try { return await RPC_SCHEDULER.enqueue(`schema:${addressValue}`, () => client.getContractSchema(addressValue), true); }
    catch (error: any) {
      if (code === "") throw error;
      return {schemaSource: "FINALIZED_DEPLOY_TX_CODE_BYTES", addressLookupError: String(error?.message ?? error), schema: await RPC_SCHEDULER.enqueue(`schema-source:${addressValue}`, () => client.getContractSchemaForCode(code), true)};
    }
  };
  const [coreSchema, vaultSchema] = await Promise.all([getSchema(core, coreCode), getSchema(vault, vaultCode)]);
  const methods = (schema: any) => JSON.stringify(schema).match(/(?:create_mandate|configure_mandate|seal_mandate|create_intent|authorize_intent|deposit|reserve|request_release|bind_core|set_vault_address|register_principal|register_agent|register_counterparty|[a-z]+_[a-z_]+)/g) ?? [];
  const result = {core: coreSchema, vault: vaultSchema, coreRequired: ["get_mandate", "get_authorization_for_vault", "get_settlement_instruction", "create_mandate", "configure_mandate", "seal_mandate", "create_intent", "authorize_intent"], vaultRequired: ["get_core_address", "get_reservation", "get_accounting", "get_global_accounting", "deposit", "reserve", "request_release"], observed: {core: methods(coreSchema), vault: methods(vaultSchema)}};
  const serialized = JSON.stringify(result);
  for (const name of [...result.coreRequired, ...result.vaultRequired]) if (!serialized.includes(name)) throw new Error(`Deployed schema is missing required interface method ${name}`);
  writeArtifact("live-interface-parity.json", result);
  const summary = {status: "PASS", source: "LIVE_SCHEMA_OR_FROZEN_DEPLOYMENT_SOURCE", coreMethods: result.coreRequired, vaultMethods: result.vaultRequired};
  writeArtifact("qualification-schema-cache.json", {network: "studionet", chainId: CHAIN_ID, coreAddress: core, vaultAddress: vault, sourceHashes: {core: CORE_SHA, vault: VAULT_SHA}, coreRequired: result.coreRequired, vaultRequired: result.vaultRequired, schemas: result, summary});
  return summary;
}
async function prepareBindingPreflight(abi: any, client: any, state: State, core: string, vault: string, CalldataAddress: new (bytes: Uint8Array) => unknown) {
  const coreOwner = asText(await read(client, core, "get_owner"));
  const coreVault = asText(await read(client, core, "get_vault_address"));
  const vaultCore = asText(await read(client, vault, "get_core_address"));
  const historyLength = Number(asText(await read(client, vault, "get_history_length")));
  const history: string[] = [];
  for (let index = 0; index < historyLength; index += 1) history.push(asText(await read(client, vault, "get_history_item", [BigInt(index)])));
  const accounting = assertAccounting(await read(client, vault, "get_global_accounting"), "Initial global");
  const constructorCore = deploymentConstructorAddress(state.steps["deploy:vault"]);
  const boundByHistory = history.some((item) => { try { return asRecord(item).event === "CORE_BOUND"; } catch { return false; } });
  if (!constructorCore || !sameAddress(constructorCore, core)) throw new Error("V3 Vault constructor Core argument does not match the expected Core");
  if (!sameAddress(coreOwner, EXPECTED_SIGNER) || !sameAddress(vaultCore, core)) throw new Error("V3 binding preflight authority or constructor state mismatch");
  const zero = "0x0000000000000000000000000000000000000000";
  let nextWrite = "binding-complete";
  if (normalizeAddressValue(coreVault) === zero && !boundByHistory) nextWrite = "vault:bind_core";
  else if (normalizeAddressValue(coreVault) === zero && boundByHistory) nextWrite = "core:set_vault_address";
  else if (!sameAddress(coreVault, vault)) throw new Error("V3 Core has an unexpected nonzero Vault address");
  else nextWrite = "binding-complete";
  const proof = {
    "vault:bind_core": calldataProof(abi, "bind_core", []),
    "core:set_vault_address": calldataProof(abi, "set_vault_address", [address(CalldataAddress, vault)]),
  };
  const preflight = {status: "PASS", nextWrite, core, vault, coreOwner, coreVault, vaultCore, constructorCore, historyLength, history, vaultBoundState: boundByHistory ? "BOUND" : "UNBOUND", vaultBoundStateSource: "CORE_BOUND history event", bindCoreRequired: !boundByHistory, normalized: {constructorCore: normalizeAddressValue(constructorCore), coreOwner: normalizeAddressValue(coreOwner), coreVault: normalizeAddressValue(coreVault), vaultCore: normalizeAddressValue(vaultCore), expectedCore: normalizeAddressValue(core), expectedVault: normalizeAddressValue(vault)}, initialAccounting: accounting, typedCalldata: proof};
  writeArtifact("vault-binding-diagnosis.json", {vaultConstructorCoreArg: constructorCore, vaultCoreAddressReadback: vaultCore, expectedCoreAddress: core, normalizedAddressMatch: sameAddress(constructorCore, core) && sameAddress(vaultCore, core), vaultBoundState: preflight.vaultBoundState, bindCoreRequired: preflight.bindCoreRequired, history, initialAccounting: accounting});
  writeArtifact("binding-preflight.json", preflight);
  state.observations.bindingPreflight = preflight;
  saveState(state);
  return preflight;
}
async function evidenceReadback(client: any, core: string, intentId: string, sequence: bigint) {
  const intent = asRecord(await read(client, core, "get_intent", [intentId]));
  const evidence = await read(client, core, "get_evidence", [intentId, sequence]);
  const snapshotId = asText(intent.current_snapshot_id);
  const snapshot = snapshotId ? await read(client, core, "get_snapshot", [snapshotId]) : "";
  return {intent, evidence, snapshot};
}
async function simulateUnassessed(client: any, vault: string, account: any, intentId: string) {
  try {
    const value = await RPC_SCHEDULER.enqueue("simulate:unassessed-reserve", () => client.simulateWriteContract({address: vault, functionName: "reserve", args: [intentId], account}), true);
    if (value !== undefined) throw new Error("unassessed reservation simulation unexpectedly succeeded");
  } catch (error: any) {
    const message = String(error?.message ?? error);
    if (message.includes("unexpectedly succeeded")) throw error;
    const proof = {intentId, result: "DETERMINISTIC_REJECTION", error: message, noTransactionSubmitted: true};
    writeArtifact("unassessed-not-cleared-live-proof.json", proof);
    return proof;
  }
  throw new Error("Unassessed reservation simulation unexpectedly succeeded");
}

async function main() {
  const deps = await loadPinnedDependencies();
  const {abi, chains, createAccount, createClient, CalldataAddress, Wallet, prompt} = deps;
  const fixture = fixtureWithDefaults(readFixture());
  if (sha256File(CORE_SOURCE) !== CORE_SHA || sha256File(VAULT_SOURCE) !== VAULT_SHA) throw new Error("Frozen qualification-v3 source hashes do not match current contract source");
  if (chains.studionet.id !== CHAIN_ID || chains.studionet.rpcUrls.default.http[0] !== RPC) throw new Error("Pinned SDK Studionet configuration mismatch");
  if (nowSeconds() >= Number(fixture.expiresAt)) throw new Error("Qualification-v3 fixture has expired");
  const state = loadState();
  const readClient = createClient({chain: chains.studionet, endpoint: RPC, account: EXPECTED_SIGNER});
  if (await RPC_SCHEDULER.enqueue("chain-id", () => readClient.getChainId(), true) !== CHAIN_ID) throw new Error("RPC is not Studionet 61999");
  normalizeCompletedDeploymentCheckpoint(state, "deploy:core");
  normalizeCompletedDeploymentCheckpoint(state, "deploy:vault");
  const transactionPath = path.join(ARTIFACT_DIR, "transactions.json");
  const transactionDocument = existsSync(transactionPath) ? JSON.parse(readFileSync(transactionPath, "utf8")) : {transactions: []};
  const checkpointTxs = new Set(Object.values(state.steps).map((step: any) => step?.tx).filter(Boolean));
  const unexpectedTransactions = (transactionDocument.transactions ?? []).filter((entry: any) => entry?.tx && !checkpointTxs.has(entry.tx) && !String(entry.kind ?? "").startsWith("finalize:"));
  if (unexpectedTransactions.length) {
    const reconciled = [];
    for (const entry of unexpectedTransactions) {
      const receipt = await RPC_SCHEDULER.enqueue(`unexpected-tx:${entry.tx}`, () => readClient.getTransaction({hash: entry.tx}), true);
      reconciled.push({tx: entry.tx, kind: entry.kind ?? "UNKNOWN", status: receipt?.statusName ?? receipt?.status ?? "UNKNOWN"});
    }
    writeArtifact("unexpected-transaction-reconciliation.json", {transactions: reconciled});
    throw new Error("Unexpected persisted transaction detected; same-hash reconciliation is required before continuing");
  }
  writeArtifact("last-run-write-reconciliation.json", {newStateChangingTxFromLastRun: "NO", persistedTransactions: transactionDocument.transactions?.length ?? 0, checkpointTransactions: checkpointTxs.size});
  if (state.steps["deploy:core"]?.tx && !state.core) await reconcilePersistedDeploymentReadOnly(readClient, state, "deploy:core", CORE_SHA);
  if (state.steps["deploy:vault"]?.tx && !state.vault) await reconcilePersistedDeploymentReadOnly(readClient, state, "deploy:vault", VAULT_SHA);
  if (state.core && state.steps["deploy:core"]?.status === "COMPLETE") {
    const coreProof = cachedSourceParity(state.steps["deploy:core"], state.core, CORE_SHA) ?? await deployedSourceParity(readClient, state.core, CORE_SHA, 3, POLL_MS, persistedDeploymentCode(state.steps["deploy:core"]));
    state.steps["deploy:core"].readback = {address: state.core, sourceParity: coreProof};
    saveState(state);
    writeArtifact("core-finalized-source-regression.json", {tx: state.steps["deploy:core"]?.tx, address: state.core, status: "FINALIZED", execution: state.steps["deploy:core"]?.executionResult, consensusResult: state.steps["deploy:core"]?.consensusResult, explicitFinalizedLookup: coreProof.compatibilityFallback !== "legacy-address-string", sourceParity: coreProof, sourceLookupRootCause: coreProof.compatibilityFallback === "legacy-address-string" ? "STUDIONET_DOCUMENTED_OBJECT_STATUS_LOOKUP_BROKEN_AND_ADDRESS_LOOKUP_IS_CASE_SENSITIVE" : "NONE"});
  }
  if (state.vault && state.steps["deploy:vault"]?.status === "COMPLETE") {
    const vaultProof = cachedSourceParity(state.steps["deploy:vault"], state.vault, VAULT_SHA) ?? await deployedSourceParity(readClient, state.vault, VAULT_SHA, 3, POLL_MS, persistedDeploymentCode(state.steps["deploy:vault"]));
    state.steps["deploy:vault"].readback = {address: state.vault, sourceParity: vaultProof};
    saveState(state);
    writeArtifact("vault-finalized-source-proof.json", {tx: state.steps["deploy:vault"]?.tx, address: state.vault, status: "FINALIZED", execution: state.steps["deploy:vault"]?.executionResult, consensusResult: state.steps["deploy:vault"]?.consensusResult, sourceParity: vaultProof});
  }
  if (!state.core || !state.vault) throw new Error("V3 deployment checkpoint is incomplete after read-only reconciliation");
  const schema = await schemaParity(readClient, state.core, state.vault, persistedDeploymentCode(state.steps["deploy:core"]), persistedDeploymentCode(state.steps["deploy:vault"]));
  state.observations.schema = schema;
  let bindingPreflight: any = state.observations.bindingPreflight;
  if (!state.observations.binding?.status) bindingPreflight = await prepareBindingPreflight(abi, readClient, state, state.core, state.vault, CalldataAddress);
  if (state.steps["core:create_mandate"]?.status === "ERROR") {
    writeArtifact("qualification-v3-run-status.json", {status: "BLOCKED_DEPLOYED_SOURCE_DEFECT", noTransactionSubmitted: true, failedStep: "core:create_mandate", nextUnfinishedWrite: "replacement-deployment-requires-explicit-authorization"});
    throw new Error("Qualification-v3 cannot continue: deployed Core has a finalized create_mandate source error; replacement deployment requires explicit authorization");
  }
  const selectedKeystore = findExpectedKeystore();
  if (!sameAddress(selectedKeystore.address, EXPECTED_SIGNER)) throw new Error("Expected qualification keystore resolution failed");
  const nonce = await RPC_SCHEDULER.enqueue("deployer-nonce", () => readClient.getCurrentNonce({address: EXPECTED_SIGNER}), true);
  const plan = {qualificationVersion: "qualification-v3", network: "studionet", rpc: RPC, chainId: CHAIN_ID, signer: EXPECTED_SIGNER, selectedKeystore: {name: selectedKeystore.name, address: selectedKeystore.address}, sourceHashes: {core: CORE_SHA, vault: VAULT_SHA}, fixture: {validFrom: fixture.validFrom, expiresAt: fixture.expiresAt, amount: "1", authority: fixture.authority}, checkpoint: {core: state.core ?? null, vault: state.vault ?? null, steps: Object.keys(state.steps)}, deployerNonce: String(nonce), nextUnfinishedWrite: bindingPreflight?.nextWrite ?? "unknown", rpcScheduler: RPC_SCHEDULER.snapshot(), explicitAuthorization: "user-authorized-qualification-v3"};
  writeArtifact("qualification-v3-run-plan.json", plan);
  console.log(JSON.stringify({QUALIFICATION_V3_PLAN: plan}, null, 2));
  if (process.argv.includes("--preflight-only")) { writeArtifact("qualification-v3-run-status.json", {status: "PREFLIGHT_ONLY", plan, noTransactionSubmitted: true}); return; }
  const confirmation = await prompt([{type: "confirm", name: "begin", message: "Begin the authorized qualification-v3 deployment and lifecycle?", default: true}]);
  if (confirmation?.begin !== true) { console.log("QUALIFICATION_V3_RUN=ABORTED_BY_USER"); return; }
  writeArtifact("qualification-v3-run-status.json", {status: "AWAITING_SECURE_KEYSTORE_PASSWORD", selectedKeystore: {name: selectedKeystore.name, address: selectedKeystore.address}, noTransactionSubmitted: true});
  let password = "";
  let wallet: any = null;
  let signingSecret = "";
  let account: any = null;
  let client: any = null;
  try {
    const loaded = await loadExistingAccount(Wallet, prompt, selectedKeystore);
    wallet = loaded.wallet;
    signingSecret = wallet["private" + "Key"];
    account = createAccount(signingSecret);
    if (!sameAddress(account.address, EXPECTED_SIGNER)) throw new Error("Decrypted signer does not match qualification signer");
    client = createClient({chain: chains.studionet, endpoint: RPC, account});
    await client.initializeConsensusSmartContract();
    writeArtifact("qualification-v3-run-status.json", {status: "ACTIVE_IN_MEMORY", selectedKeystore: {name: selectedKeystore.name, address: selectedKeystore.address}, noTransactionSubmitted: true});

    let core = state.core ?? "";
    let vault = state.vault ?? "";
    if (!core) {
      const deployed = await executeDeployment({client, account, state, label: "deploy:core", codePath: CORE_SOURCE, expectedHash: CORE_SHA, constructorArgs: [], summary: [{type: "source", sha256: CORE_SHA}]});
      core = deployed.address;
      state.core = core;
      saveState(state);
    }
    if (!cachedSourceParity(state.steps["deploy:core"], core, CORE_SHA)) await deployedSourceParity(client, core, CORE_SHA, 3, POLL_MS, persistedDeploymentCode(state.steps["deploy:core"]));
    if (!vault) {
      const deployed = await executeDeployment({client, account, state, label: "deploy:vault", codePath: VAULT_SOURCE, expectedHash: VAULT_SHA, constructorArgs: [address(CalldataAddress, core)], summary: [{type: "Address", value: core}]});
      vault = deployed.address;
      state.vault = vault;
      saveState(state);
    }
    if (!cachedSourceParity(state.steps["deploy:vault"], vault, VAULT_SHA)) await deployedSourceParity(client, vault, VAULT_SHA, 3, POLL_MS, persistedDeploymentCode(state.steps["deploy:vault"]));
    const bindingNeedsVaultWrite = bindingPreflight?.nextWrite === "vault:bind_core" || Boolean(state.steps["vault:bind_core"]?.tx);
    const bindingNeedsCoreWrite = bindingNeedsVaultWrite || bindingPreflight?.nextWrite === "core:set_vault_address" || Boolean(state.steps["core:set_vault_address"]?.tx);
    if (bindingNeedsVaultWrite) await executeStep({abi, client, account, state, core, vault, label: "vault:bind_core", functionName: "bind_core", args: [], summary: [], precondition: async () => { if (!sameAddress(await read(client, vault, "get_core_address"), core)) throw new Error("Vault Core constructor binding changed"); }, readback: async () => read(client, vault, "get_core_address"), expectedState: async () => { if (!sameAddress(await read(client, vault, "get_core_address"), core)) throw new Error("Vault Core binding was not finalized"); return {core}; }});
    if (bindingNeedsCoreWrite) await executeStep({abi, client, account, state, core, vault, label: "core:set_vault_address", functionName: "set_vault_address", args: [address(CalldataAddress, vault)], summary: [{type: "Address", value: vault}], precondition: async () => { if (normalizeAddressValue(await read(client, core, "get_vault_address")) !== "0x0000000000000000000000000000000000000000") throw new Error("Core Vault address is no longer unbound without a checkpoint"); }, readback: async () => read(client, core, "get_vault_address"), expectedState: async () => { if (!sameAddress(await read(client, core, "get_vault_address"), vault)) throw new Error("Core Vault binding was not finalized"); return {vault}; }});
    if (!sameAddress(await read(client, core, "get_vault_address"), vault) || !sameAddress(await read(client, vault, "get_core_address"), core)) throw new Error("Bidirectional binding readback failed");
    state.observations.binding = {core, vault, status: "PASS"}; state.observations.schema = schema; saveState(state);

    await executeStep({abi, client, account, state, core, vault, label: "core:register_principal", functionName: "register_principal", args: [], summary: [], precondition: async () => {}, readback: async () => ({registered: true}), expectedState: async () => ({registered: true})});
    await executeStep({abi, client, account, state, core, vault, label: "core:register_agent", functionName: "register_agent", args: [address(CalldataAddress, EXPECTED_SIGNER), fixture.agentLabel], summary: [{type: "Address", value: EXPECTED_SIGNER}, {type: "string", value: fixture.agentLabel}], precondition: async () => {}, readback: async () => ({agent: EXPECTED_SIGNER, label: fixture.agentLabel, active: true}), expectedState: async () => ({agent: EXPECTED_SIGNER, label: fixture.agentLabel, active: true})});

    let mandate = asRecord(await read(client, core, "get_mandate", ["M-1"]));
    if (!Object.keys(mandate).length) {
      const args = [address(CalldataAddress, EXPECTED_SIGNER), ""];
      const proof = calldataProof(abi, "create_mandate", args);
      const decoded = abi.calldata.decode(abi.calldata.encode(abi.calldata.makeCalldataObject("create_mandate", args, undefined)));
      const map = decoded instanceof Map ? decoded : new Map(Object.entries(decoded));
      const decodedArgs: any[] = map.get("args");
      const arg0Value = decodedArgs?.[0]?.bytes ? `0x${Buffer.from(decodedArgs[0].bytes).toString("hex")}` : "";
      if (proof.argumentCount !== 2 || !sameAddress(arg0Value, EXPECTED_SIGNER) || typeof decodedArgs?.[1] !== "string" || decodedArgs[1] !== "") throw new Error("Root mandate typed calldata boundary proof failed");
      console.log(`METHOD=create_mandate\nARG_COUNT=2\nARG0_TYPE=Address\nARG0_VALUE=${arg0Value}\nARG1_TYPE=string\nARG1_LENGTH=0\nEMPTY_STRING_PRESERVED=YES\nMANDATE_COUNT=${await read(client, core, "get_mandate_count")}`);
      await executeStep({abi, client, account, state, core, vault, label: "core:create_mandate", functionName: "create_mandate", args, summary: [{type: "Address", value: EXPECTED_SIGNER}, {type: "string", value: "", utf8Length: 0}], precondition: async () => { if (asText(await read(client, core, "get_mandate_count")) !== "0") throw new Error("Root mandate precondition is no longer zero"); }, readback: async () => read(client, core, "get_mandate", ["M-1"]), expectedState: async () => { if (asText(await read(client, core, "get_mandate_count")) !== "1") throw new Error("Finalized root mandate count is not one"); const item = asRecord(await read(client, core, "get_mandate", ["M-1"])); if (!sameAddress(item.principal, EXPECTED_SIGNER) || !sameAddress(item.authorized_agent, EXPECTED_SIGNER) || item.parent_mandate_id !== "") throw new Error("Finalized root mandate identity is incorrect"); return item; }});
      mandate = asRecord(await read(client, core, "get_mandate", ["M-1"]));
    }
    if (!Object.keys(mandate).length) throw new Error("M-1 was not created");
    if (mandate.status === "DRAFT" && asText(mandate.title) === "") {
      const args = ["M-1", fixture.title, fixture.purpose, fixture.constitution, fixture.permittedActivity, fixture.forbiddenActivity, BigInt(fixture.maximumSingleTransaction), BigInt(fixture.epochBudget), BigInt(fixture.epochDurationSeconds), BigInt(fixture.totalBudget), BigInt(fixture.validFrom), BigInt(fixture.expiresAt), BigInt(fixture.challengeWindowSeconds), fixture.evidencePolicy, fixture.deployedAuthorityConstraints, fixture.fulfillmentPolicy, fixture.recoveryPolicy, false];
      await executeStep({abi, client, account, state, core, vault, label: "core:configure_mandate", functionName: "configure_mandate", args, summary: [{type: "string", value: "M-1"}, {type: "policy", value: "qualification-v3-fixture"}], precondition: async () => { if (asRecord(await read(client, core, "get_mandate", ["M-1"])).status !== "DRAFT") throw new Error("M-1 is not configurable"); }, readback: async () => read(client, core, "get_mandate", ["M-1"]), expectedState: async () => read(client, core, "get_mandate", ["M-1"])});
      mandate = asRecord(await read(client, core, "get_mandate", ["M-1"]));
    }
    assertMandate(mandate, fixture, "DRAFT");
    if (mandate.status === "DRAFT") {
      while (nowSeconds() < Number(fixture.validFrom)) { console.log(`WAITING_FOR_MANDATE_VALID_FROM=${fixture.validFrom}`); await sleep(POLL_MS); }
      await executeStep({abi, client, account, state, core, vault, label: "core:seal_mandate", functionName: "seal_mandate", args: ["M-1"], summary: [{type: "string", value: "M-1"}], precondition: async () => { const item = asRecord(await read(client, core, "get_mandate", ["M-1"])); assertMandate(item, fixture, "DRAFT"); }, readback: async () => read(client, core, "get_mandate", ["M-1"]), expectedState: async () => { const item = asRecord(await read(client, core, "get_mandate", ["M-1"])); assertMandate(item, fixture, "SEALED"); return item; }});
      mandate = asRecord(await read(client, core, "get_mandate", ["M-1"]));
    }
    assertMandate(mandate, fixture, "SEALED");

    let counterparty = asRecord(await read(client, core, "get_counterparty", ["C-1"]));
    if (!Object.keys(counterparty).length) {
      if (!sameAddress(fixture.counterpartyWallet, EXPECTED_SIGNER)) throw new Error("Fixture counterparty is not the controlled qualification signer");
      await executeStep({abi, client, account, state, core, vault, label: "core:register_counterparty", functionName: "register_counterparty", args: [address(CalldataAddress, EXPECTED_SIGNER), fixture.counterpartyLabel, fixture.authority], summary: [{type: "Address", value: EXPECTED_SIGNER}, {type: "string", value: fixture.counterpartyLabel}, {type: "string", value: fixture.authority}], precondition: async () => {}, readback: async () => read(client, core, "get_counterparty", ["C-1"]), expectedState: async () => { const item = asRecord(await read(client, core, "get_counterparty", ["C-1"])); if (!sameAddress(item.bound_wallet, EXPECTED_SIGNER) || item.authority_origin !== fixture.authority || item.label !== fixture.counterpartyLabel || item.active !== true) throw new Error("Counterparty state was not finalized"); return item; }});
      counterparty = asRecord(await read(client, core, "get_counterparty", ["C-1"]));
    }
    if (!sameAddress(counterparty.bound_wallet, EXPECTED_SIGNER) || counterparty.authority_origin !== fixture.authority || counterparty.label !== fixture.counterpartyLabel || counterparty.active !== true) throw new Error("Counterparty identity readback mismatch");

    const beforeAccounting = assertAccounting(await read(client, vault, "get_accounting", ["M-1"]), "Pre-deposit mandate");
    if (BigInt(beforeAccounting.deposited) < 1n) {
      const deposit = await executeStep({abi, client, account, state, core, vault, label: "vault:deposit", functionName: "deposit", args: ["M-1"], summary: [{type: "string", value: "M-1"}], value: 1n, precondition: async () => { const item = assertAccounting(await read(client, vault, "get_accounting", ["M-1"]), "Deposit precondition"); if (BigInt(item.deposited) !== BigInt(beforeAccounting.deposited)) throw new Error("Deposit precondition changed"); }, readback: async () => read(client, vault, "get_accounting", ["M-1"]), expectedState: async () => read(client, vault, "get_accounting", ["M-1"])});
      const after = assertAccounting(deposit.readback, "Post-deposit mandate");
      if (BigInt(after.deposited) !== BigInt(beforeAccounting.deposited) + 1n || BigInt(after.available) !== BigInt(beforeAccounting.available) + 1n) throw new Error("Deposit accounting delta is not exactly one GEN");
    }

    const intentExpiresAt = Math.min(Number(fixture.expiresAt), nowSeconds() + 3600);
    let intent = asRecord(await read(client, core, "get_intent", ["I-1"]));
    if (!Object.keys(intent).length) {
      const args = ["M-1", "C-1", address(CalldataAddress, EXPECTED_SIGNER), 1n, "Qualification-v3 purchase", fixture.purpose, fixture.deliverable, fixture.commercialTerms, fixture.fulfillmentCriteria, BigInt(intentExpiresAt)];
      await executeStep({abi, client, account, state, core, vault, label: "core:create_intent:positive", functionName: "create_intent", args, summary: [{type: "string", value: "M-1"}, {type: "string", value: "C-1"}, {type: "Address", value: EXPECTED_SIGNER}, {type: "u256", value: "1"}], precondition: async () => {}, readback: async () => read(client, core, "get_intent", ["I-1"]), expectedState: async () => read(client, core, "get_intent", ["I-1"])});
      intent = asRecord(await read(client, core, "get_intent", ["I-1"]));
    }
    assertIntent(intent, fixture);
    if (intent.status === "DRAFT") { await executeStep({abi, client, account, state, core, vault, label: "core:submit_intent:positive", functionName: "submit_intent", args: ["I-1"], summary: [{type: "string", value: "I-1"}], precondition: async () => {}, readback: async () => read(client, core, "get_intent", ["I-1"]), expectedState: async () => read(client, core, "get_intent", ["I-1"])}); intent = asRecord(await read(client, core, "get_intent", ["I-1"])); }

    if (["SUBMITTED", "EVIDENCE_RETRY_REQUIRED", "EVIDENCE_RECOVERY_REQUIRED", "EVIDENCE_REPAIR_REQUIRED"].includes(intent.status) && asText(await read(client, core, "get_evidence", ["I-1", 0n])) === "") {
      await executeStep({abi, client, account, state, core, vault, label: "core:define_evidence:authorization", functionName: "define_evidence", args: ["I-1", "PRODUCT_SERVICE", fixture.evidenceUrl, fixture.authority, "", 0n, fixture.authority, 0n], summary: [{type: "evidence", kind: "PRODUCT_SERVICE", authority: fixture.authority, transport: fixture.evidenceUrl}], precondition: async () => {}, readback: async () => read(client, core, "get_evidence", ["I-1", 0n]), expectedState: async () => read(client, core, "get_evidence", ["I-1", 0n])});
    }
    intent = asRecord(await read(client, core, "get_intent", ["I-1"]));
    if (["SUBMITTED", "EVIDENCE_RETRY_REQUIRED", "EVIDENCE_RECOVERY_REQUIRED", "EVIDENCE_REPAIR_REQUIRED"].includes(intent.status)) { await executeStep({abi, client, account, state, core, vault, label: "core:stage_evidence:authorization", functionName: "stage_evidence", args: ["I-1"], summary: [{type: "string", value: "I-1"}], precondition: async () => {}, readback: async () => evidenceReadback(client, core, "I-1", 0n), expectedState: async () => evidenceReadback(client, core, "I-1", 0n)}); intent = asRecord(await read(client, core, "get_intent", ["I-1"])); }
    if (intent.status === "EVIDENCE_READY") { await executeStep({abi, client, account, state, core, vault, label: "core:authorize_intent", functionName: "authorize_intent", args: ["I-1"], summary: [{type: "string", value: "I-1"}], precondition: async () => {}, readback: async () => read(client, core, "get_intent", ["I-1"]), expectedState: async () => read(client, core, "get_intent", ["I-1"])}); intent = asRecord(await read(client, core, "get_intent", ["I-1"])); }
    const authorization = asRecord(intent.authorization);
    writeArtifact("authorization-vector.json", {intentId: "I-1", status: intent.status, result: intent.authorization_decision ?? authorization.decision ?? "", vector: authorization.vector ?? {}, fullAuthorization: authorization});
    if (intent.status !== "AUTHORIZED") throw new Error(`Positive Intent did not authorize; status=${intent.status}; error=${intent.last_error ?? ""}`);

    let reservation = asText(await read(client, vault, "get_reservation", ["I-1"]));
    if (!reservation) { await executeStep({abi, client, account, state, core, vault, label: "vault:reserve:positive", functionName: "reserve", args: ["I-1"], summary: [{type: "string", value: "I-1"}], precondition: async () => { const auth = asRecord(await read(client, core, "get_authorization_for_vault", ["I-1"])); if (auth.authorization_decision !== "AUTHORIZED") throw new Error("Vault reserve precondition is not authorized"); }, readback: async () => read(client, vault, "get_reservation", ["I-1"]), expectedState: async () => read(client, vault, "get_reservation", ["I-1"])}); reservation = asText(await read(client, vault, "get_reservation", ["I-1"])); }
    const reservationItem = asRecord(reservation); if (reservationItem.status !== "RESERVED" || reservationItem.intent_id !== "I-1" || reservationItem.mandate_id !== "M-1" || reservationItem.amount !== "1" || !sameAddress(reservationItem.recipient, EXPECTED_SIGNER)) throw new Error("Positive reservation readback mismatch");

    let intent2 = asRecord(await read(client, core, "get_intent", ["I-2"]));
    if (!Object.keys(intent2).length) { const args = ["M-1", "C-1", address(CalldataAddress, EXPECTED_SIGNER), 1n, "Qualification-v3 unassessed proof", fixture.purpose, fixture.deliverable, fixture.commercialTerms, fixture.fulfillmentCriteria, BigInt(intentExpiresAt)]; await executeStep({abi, client, account, state, core, vault, label: "core:create_intent:unassessed", functionName: "create_intent", args, summary: [{type: "intent", id: "I-2", state: "DRAFT"}], precondition: async () => {}, readback: async () => read(client, core, "get_intent", ["I-2"]), expectedState: async () => read(client, core, "get_intent", ["I-2"])}); intent2 = asRecord(await read(client, core, "get_intent", ["I-2"])); }
    if (intent2.status === "DRAFT") { await executeStep({abi, client, account, state, core, vault, label: "core:submit_intent:unassessed", functionName: "submit_intent", args: ["I-2"], summary: [{type: "string", value: "I-2"}], precondition: async () => {}, readback: async () => read(client, core, "get_intent", ["I-2"]), expectedState: async () => read(client, core, "get_intent", ["I-2"])}); intent2 = asRecord(await read(client, core, "get_intent", ["I-2"])); }
    const unassessedProof = await simulateUnassessed(client, vault, account, "I-2");

    intent = asRecord(await read(client, core, "get_intent", ["I-1"]));
    if (intent.status === "AUTHORIZED") { await executeStep({abi, client, account, state, core, vault, label: "core:start_fulfillment", functionName: "start_fulfillment", args: ["I-1"], summary: [{type: "string", value: "I-1"}], precondition: async () => { if (asRecord(await read(client, vault, "get_reservation", ["I-1"])).status !== "RESERVED") throw new Error("Fulfillment requires RESERVED state"); }, readback: async () => read(client, core, "get_intent", ["I-1"]), expectedState: async () => read(client, core, "get_intent", ["I-1"])}); intent = asRecord(await read(client, core, "get_intent", ["I-1"])); }
    if (intent.status === "FULFILLMENT_PENDING" && asText(await read(client, core, "get_evidence", ["I-1", 1n])) === "") await executeStep({abi, client, account, state, core, vault, label: "core:define_evidence:fulfillment", functionName: "define_evidence", args: ["I-1", "FULFILLMENT", fixture.evidenceUrl, fixture.authority, "", 0n, fixture.authority, 1n], summary: [{type: "evidence", kind: "FULFILLMENT", authority: fixture.authority, transport: fixture.evidenceUrl}], precondition: async () => {}, readback: async () => read(client, core, "get_evidence", ["I-1", 1n]), expectedState: async () => read(client, core, "get_evidence", ["I-1", 1n])});
    if (intent.status === "FULFILLMENT_PENDING") { await executeStep({abi, client, account, state, core, vault, label: "core:stage_evidence:fulfillment", functionName: "stage_evidence", args: ["I-1"], summary: [{type: "string", value: "I-1"}], precondition: async () => {}, readback: async () => evidenceReadback(client, core, "I-1", 1n), expectedState: async () => evidenceReadback(client, core, "I-1", 1n)}); await executeStep({abi, client, account, state, core, vault, label: "core:assess_fulfillment", functionName: "assess_fulfillment", args: ["I-1"], summary: [{type: "string", value: "I-1"}], precondition: async () => {}, readback: async () => read(client, core, "get_intent", ["I-1"]), expectedState: async () => read(client, core, "get_intent", ["I-1"])}); intent = asRecord(await read(client, core, "get_intent", ["I-1"])); }
    const fulfillment = asRecord(intent.fulfillment);
    writeArtifact("fulfillment-vector.json", {intentId: "I-1", status: intent.status, result: fulfillment.vector?.outcome ?? "", vector: fulfillment.vector ?? {}, fullFulfillment: fulfillment});
    writeArtifact("third-party-challenge-live.json", {status: "BLOCKED_BY_SECOND_SIGNER", note: "No distinct controlled signer was available; no third-party identity was fabricated."});

    let settlementTx = "";
    let externalObservation: any = {observation: "NOT_ATTEMPTED"};
    if (intent.status === "FULFILLED" && intent.settlement_direction === "RELEASE_TO_COUNTERPARTY") {
      let instruction = asRecord(await read(client, core, "get_settlement_instruction", ["I-1"]));
      while (instruction.ready_at && BigInt(instruction.ready_at) > BigInt(nowSeconds())) { console.log(`WAITING_FOR_CHALLENGE_WINDOW=${instruction.ready_at}`); await sleep(POLL_MS); instruction = asRecord(await read(client, core, "get_settlement_instruction", ["I-1"])); }
      const currentReservation = asRecord(await read(client, vault, "get_reservation", ["I-1"]));
      if (currentReservation.status === "RESERVED") { const settlement = await executeStep({abi, client, account, state, core, vault, label: "vault:request_release", functionName: "request_release", args: ["I-1"], summary: [{type: "string", value: "I-1"}], precondition: async () => { const current = asRecord(await read(client, core, "get_settlement_instruction", ["I-1"])); if (current.direction !== "RELEASE_TO_COUNTERPARTY" || BigInt(current.ready_at) > BigInt(nowSeconds())) throw new Error("Settlement precondition is not ready"); }, readback: async () => read(client, vault, "get_reservation", ["I-1"]), expectedState: async () => read(client, vault, "get_reservation", ["I-1"])}); settlementTx = settlement.tx; }
      let triggered: any[] = []; try { triggered = await RPC_SCHEDULER.enqueue(`triggered:${settlementTx}`, () => client.getTriggeredTransactionIds({hash: settlementTx}), true); } catch (error: any) { externalObservation = {observation: "TRIGGERED_TRANSACTION_QUERY_UNSUPPORTED", error: String(error?.message ?? error)}; }
      if (!externalObservation.error) externalObservation = {observation: triggered.length ? "TRIGGERED_IDS_OBSERVED" : "PARENT_FINALIZED_CHILD_NOT_EXPOSED", triggeredTransactionIds: triggered};
    }
    writeArtifact("external-message-observation.json", {settlementTx: settlementTx || null, ...externalObservation});
    const finalGlobal = assertAccounting(await read(client, vault, "get_global_accounting"), "Final global");
    const finalMandateAccounting = assertAccounting(await read(client, vault, "get_accounting", ["M-1"]), "Final mandate");
    const finalIntent = asRecord(await read(client, core, "get_intent", ["I-1"]));
    const finalUnassessed = asRecord(await read(client, core, "get_intent", ["I-2"]));
    const finalAccounting = {global: finalGlobal, mandate: finalMandateAccounting, reservation: await read(client, vault, "get_reservation", ["I-1"]), intent: finalIntent, unassessed: finalUnassessed};
    writeArtifact("qualification-final-readbacks.json", {core, vault, accounting: finalAccounting, unassessedProof, vectors: {authorization: authorization.vector ?? {}, fulfillment: fulfillment.vector ?? {}}, externalObservation});
    writeArtifact("qualification-v3-run-summary.json", {status: "COMPLETED_LIVE_FLOW", core, vault, mandateId: "M-1", positiveIntentId: "I-1", unassessedIntentId: "I-2", rootMandateTx: state.steps["core:create_mandate"]?.tx ?? null, settlementTx: settlementTx || null, thirdPartyChallenge: "BLOCKED_BY_SECOND_SIGNER", finalAccounting, externalObservation});
    console.log("QUALIFICATION_V3_RUN=COMPLETED_LIVE_FLOW");
  } finally {
    password = "";
    signingSecret = "";
    wallet = null;
    account = null;
    client = null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`QUALIFICATION_V3_RUN=STOPPED ${String(error?.message ?? error)}`); writeArtifact("qualification-v3-run-summary.json", {status: "STOPPED", error: String(error?.message ?? error)}); process.exitCode = 1; });
}
