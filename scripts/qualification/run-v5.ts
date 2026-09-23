import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  findExpectedKeystore,
  loadExistingAccount,
  loadPinnedDependencies,
} from "./create-root-mandate.ts";
import {
  FALLBACK_LATEST_FINAL,
  getTriggeredTransactionIds,
  readLatestFinalPostcondition,
  reconcileSameHash,
  requireSuccessfulExecution,
  sendDeployOnce,
  sendWriteOnce,
} from "./lib/official-transaction.ts";
import {
  appendAuthorizationAttempt,
  assertRetryPlan,
  authorizationAttempts,
  ensureAuthorizationCheckpoint,
  parseRetryStep,
  nextAuthorizationAttemptNumber,
  updateLatestAuthorizationAttempt,
  AUTHORIZATION_STEP,
} from "./lib/checkpoint-retry.ts";
import {runSimulation} from "./v4-lifecycle-simulation.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RPC = "https://studio.genlayer.com/api";
const CHAIN_ID = 61999;
const NETWORK = "studionet";
const EXPECTED_SIGNER = "0xcb5a845638cbc1f95d7f8343278685682c3ba13f";
const EXPECTED_KEYSTORE = "meritround-v2-studionet";
const CORE_SOURCE = path.join(ROOT, "contracts", "pavel_core.py");
const VAULT_SOURCE = path.join(ROOT, "contracts", "pavel_vault.py");
const CORE_SHA = "1e767f9d8a8cf927e8e20dd5d5b8d6fb1481af77a2dd3ad159f94e4691d8fd5b";
const VAULT_SHA = "d967d6f1e70cd698fc428338ca822c5541ce07fd7977517db7bb19f9796aa8ed";
const ARTIFACT_DIR = path.join(ROOT, "artifacts", "studionet", "qualification-v5");
const STATE_PATH = path.join(ARTIFACT_DIR, "checkpoint.json");
const TRANSACTION_PATH = path.join(ARTIFACT_DIR, "transactions.json");
const EVIDENCE_URL = "https://docs.genlayer.com/robots.txt";
const EVIDENCE_AUTHORITY = "docs.genlayer.com";
const MINIMAL_AMOUNT = 1n;
const SEAL_MARGIN_SECONDS = 900;
const MINIMUM_SAFE_SEAL_REMAINING = 180;
const QUALIFICATION_HORIZON_SECONDS = 172800;
const POLL_MS = 5000;
let LATEST_FINAL: string = FALLBACK_LATEST_FINAL;

type AnyRecord = Record<string, any>;
type Fixture = AnyRecord;
type Step = {
  label: string;
  tx?: string;
  tx_hash?: string;
  status: string;
  execution?: string;
  terminal_status?: string;
  execution_success?: boolean;
  consensus_result?: string;
  canonical_postcondition_met?: boolean;
  retry_permitted?: boolean;
  attempt_number?: number;
  attempt_history?: AnyRecord[];
  lifecycle?: string;
  readback?: any;
  summary?: any;
  error?: string;
  submittedAt?: string;
};
type State = {
  version: "qualification-v5";
  network: string;
  rpc: string;
  chainId: number;
  signer: string;
  core?: string;
  vault?: string;
  sourceHashes: {core: string; vault: string};
  steps: Record<string, Step>;
  completedSteps: Record<string, Step>;
  failedAttempts: Step[];
  submittedTransactions: Step[];
  authorizationResubmissions: number;
  authorization?: {attempts: AnyRecord[]};
  observations: AnyRecord;
};

function jsonSafe(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    const output: AnyRecord = {};
    for (const [key, item] of Object.entries(value)) output[key] = jsonSafe(item);
    return output;
  }
  return value;
}

function writeArtifact(name: string, value: any) {
  mkdirSync(ARTIFACT_DIR, {recursive: true});
  writeFileSync(path.join(ARTIFACT_DIR, name), `${JSON.stringify(jsonSafe(value), null, 2)}\n`);
}

function sha256Bytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(filePath: string) {
  return sha256Bytes(new Uint8Array(readFileSync(filePath)));
}

function sameAddress(left: unknown, right: unknown) {
  const a = String(left ?? "").trim().toLowerCase();
  const b = String(right ?? "").trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(a) && /^0x[0-9a-f]{40}$/.test(b) && a === b;
}

function preserveAddress(value: unknown) {
  const text = String(value ?? "").trim();
  return /^0x[0-9a-fA-F]{40}$/.test(text) ? text : "";
}

function calldataAddress(CalldataAddress: new (bytes: Uint8Array) => unknown, value: string) {
  return new CalldataAddress(Uint8Array.from(Buffer.from(value.slice(2), "hex")));
}

function asRecord(value: any): AnyRecord {
  if (typeof value === "string") return value === "" ? {} : JSON.parse(value);
  return value && typeof value === "object" ? value : {};
}

function asNumber(value: any, field: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${field} is not a safe non-negative integer`);
  return number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runGate(label: string, executable: string, args: string[]) {
  const command = process.platform === "win32" && executable === "pnpm" ? "pnpm.cmd" : executable;
  try {
    execFileSync(command, args, {
      cwd: ROOT,
      env: {...process.env, GENVM_VERSION: "v0.2.16"},
      encoding: "utf8",
      stdio: "pipe",
      timeout: 300000,
      shell: process.platform === "win32" && (command.endsWith(".cmd") || command === "powershell"),
    });
    return {label, status: "PASS"};
  } catch (error: any) {
    writeArtifact(`gate-failure-${label}.json`, {label, status: "FAIL", error: String(error?.message ?? error), stdout: String(error?.stdout ?? "").slice(-8000), stderr: String(error?.stderr ?? "").slice(-8000)});
    throw new Error(`V5 preflight gate failed: ${label}`);
  }
}

class RpcScheduler {
  private tail: Promise<void> = Promise.resolve();
  private nextAllowedAt = 0;

  async read<T>(label: string, operation: () => Promise<T>): Promise<T> {
    let resolveResult!: (value: T | PromiseLike<T>) => void;
    let rejectResult!: (reason?: any) => void;
    const result = new Promise<T>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    const run = async () => {
      try {
        const wait = Math.max(0, this.nextAllowedAt - Date.now());
        if (wait > 0) await sleep(wait);
        this.nextAllowedAt = Date.now() + 2500;
        resolveResult(await operation());
      } catch (error) {
        rejectResult(error);
      }
    };
    this.tail = this.tail.then(run, run);
    return result;
  }

  async write<T>(label: string, operation: () => Promise<T>): Promise<T> {
    return this.read(`write:${label}`, operation);
  }
}

const scheduler = new RpcScheduler();

function emptyState(): State {
  return {
    version: "qualification-v5",
    network: NETWORK,
    rpc: RPC,
    chainId: CHAIN_ID,
    signer: EXPECTED_SIGNER,
    sourceHashes: {core: CORE_SHA, vault: VAULT_SHA},
    steps: {},
    completedSteps: {},
    failedAttempts: [],
    submittedTransactions: [],
    authorizationResubmissions: 0,
    authorization: {attempts: []},
    observations: {},
  };
}

function loadState(): State {
  if (!existsSync(STATE_PATH)) return emptyState();
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8")) as State;
  if (state.version !== "qualification-v5" || state.network !== NETWORK || state.rpc !== RPC || state.chainId !== CHAIN_ID || !sameAddress(state.signer, EXPECTED_SIGNER)) {
    throw new Error("V5 checkpoint has the wrong network, signer, or qualification version");
  }
  if (state.sourceHashes?.core !== CORE_SHA || state.sourceHashes?.vault !== VAULT_SHA) throw new Error("V5 checkpoint source identity does not match the frozen source");
  state.steps ??= {};
  state.completedSteps ??= {};
  state.failedAttempts ??= [];
  state.submittedTransactions ??= [];
  state.authorizationResubmissions ??= 0;
  state.authorization ??= {attempts: []};
  ensureAuthorizationCheckpoint(state);
  state.observations ??= {};
  return state;
}

function saveState(state: State) {
  writeArtifact("checkpoint.json", state);
}

function recordSubmitted(state: State, step: Step) {
  state.submittedTransactions = state.submittedTransactions.filter((item) => item.tx !== step.tx);
  state.submittedTransactions.push({...step});
}

function recordFailed(state: State, step: Step) {
  delete state.completedSteps[step.label];
  state.failedAttempts = state.failedAttempts.filter((item) => item.tx !== step.tx);
  state.failedAttempts.push({...step});
}

function recordComplete(state: State, step: Step) {
  state.completedSteps[step.label] = {...step};
}

function appendTransaction(entry: AnyRecord) {
  mkdirSync(ARTIFACT_DIR, {recursive: true});
  const document = existsSync(TRANSACTION_PATH) ? JSON.parse(readFileSync(TRANSACTION_PATH, "utf8")) : {network: NETWORK, rpc: RPC, chainId: CHAIN_ID, transactions: []};
  document.transactions ??= [];
  const index = document.transactions.findIndex((item: AnyRecord) => item.tx === entry.tx);
  if (index < 0) document.transactions.push(jsonSafe(entry));
  else document.transactions[index] = {...document.transactions[index], ...jsonSafe(entry)};
  writeArtifact("transactions.json", document);
}

function read(client: AnyRecord, address: string, functionName: string, args: any[] = []) {
  return scheduler.read(`read:${address}:${functionName}`, () => readLatestFinalPostcondition({client, address, functionName, args, account: EXPECTED_SIGNER, transactionHashVariant: LATEST_FINAL}));
}

function calldataRoundTrip(abi: AnyRecord, functionName: string, args: any[]) {
  const original = abi.calldata.makeCalldataObject(functionName, args, undefined);
  const encoded = abi.calldata.encode(original);
  const decoded = abi.calldata.decode(encoded);
  const map = decoded instanceof Map ? decoded : new Map(Object.entries(decoded));
  const decodedArgs = map.get("args") ?? [];
  if (!Array.isArray(decodedArgs) || decodedArgs.length !== args.length) throw new Error(`${functionName} calldata argument count mismatch`);
  for (let index = 0; index < args.length; index += 1) {
    const expected = args[index];
    const actual = decodedArgs[index];
    if (typeof expected === "string" && actual !== expected) throw new Error(`${functionName} calldata string argument ${index} changed during round-trip`);
    if (typeof expected === "bigint" && String(actual) !== String(expected)) throw new Error(`${functionName} calldata numeric argument ${index} changed during round-trip`);
    if (expected && typeof expected === "object" && "bytes" in expected) {
      const actualAddress = actual?.bytes ? `0x${Buffer.from(actual.bytes).toString("hex")}` : String(actual);
      const expectedAddress = `0x${Buffer.from(expected.bytes).toString("hex")}`;
      if (!sameAddress(actualAddress, expectedAddress)) throw new Error(`${functionName} calldata address argument ${index} changed during round-trip`);
    }
  }
  return {method: functionName, argumentCount: decodedArgs.length, encodedBytes: Array.from(encoded), roundTrip: abi.calldata.toString(decoded)};
}

function validateEvidenceUrl(url: string, authority: string) {
  if (!url.startsWith("https://")) throw new Error("Evidence URL must start with exactly https://");
  if (url.length > 512 || /\s/.test(url)) throw new Error("Evidence URL length/content is invalid");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hostname.toLowerCase() !== authority.toLowerCase()) throw new Error("Evidence URL authority policy failed");
  return {url, authority: authority.toLowerCase(), hostname: parsed.hostname.toLowerCase(), protocol: parsed.protocol};
}

async function fetchEvidence() {
  const response = await fetch(EVIDENCE_URL, {redirect: "follow"});
  const bytes = new Uint8Array(await response.arrayBuffer());
  const result = {
    status: response.status,
    finalUrl: response.url,
    contentType: response.headers.get("content-type") ?? "",
    byteLength: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  };
  if (result.status !== 200 || result.finalUrl !== EVIDENCE_URL || result.byteLength === 0 || result.byteLength > 8192) throw new Error(`Evidence resource preflight failed: ${JSON.stringify(result)}`);
  validateEvidenceUrl(result.finalUrl, EVIDENCE_AUTHORITY);
  return result;
}

async function chainTime(client: AnyRecord) {
  const block: AnyRecord = await scheduler.read("chain-time", () => client.request({method: "eth_getBlockByNumber", params: ["latest", false]}));
  const raw = block?.timestamp;
  const value = typeof raw === "string" && raw.startsWith("0x") ? Number.parseInt(raw.slice(2), 16) : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Studionet latest finalized chain timestamp is unavailable");
  return {chainNow: value, blockNumber: block?.number ?? null, source: "eth_getBlockByNumber:latest"};
}

function methodNames(schema: any) {
  const schemaMethods = Object.keys(schema?.methods ?? {});
  if (schemaMethods.length > 0) return schemaMethods;
  const text = JSON.stringify(schema);
  const matches = [...text.matchAll(/"name"\s*:\s*"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((item) => item[1]);
  return [...new Set(matches)];
}

function requireMethods(schema: any, required: string[], label: string) {
  const names = methodNames(schema);
  for (const method of required) if (!names.includes(method)) throw new Error(`${label} schema is missing ${method}`);
  return names;
}

function fixture(): Fixture {
  return {
    title: "Qualification V5 digital deliverable",
    purpose: "Acquire and deliver the registered GenLayer documentation authority artifact for qualification-v5 only.",
    constitution: "The agent may act only within this sealed qualification-v5 constitution; deterministic limits and source authorities are binding.",
    permittedActivity: "Obtain and deliver the registered GenLayer documentation authority artifact for this qualification-v5 run.",
    forbiddenActivity: "No recurring payments; no subscriptions; no token purchases; no unrelated services; no alternate recipients.",
    evidencePolicy: "Authenticated HTTPS evidence from docs.genlayer.com is required.",
    authorityConstraints: EVIDENCE_AUTHORITY,
    fulfillmentPolicy: "The named qualification-v5 digital deliverable must be materially delivered and evidenced.",
    recoveryPolicy: "Only same-byte authenticated recovery through docs.genlayer.com is permitted.",
    commercialTerms: "One qualification-v5-only delivery; no recurring payment; value is one minimal GEN unit.",
    fulfillmentCriteria: "The exact registered-authority artifact is available and corresponds to the frozen qualification-v5 Intent.",
    deliverable: "The official GenLayer documentation authority artifact at the registered authority.",
    maximumSingleTransaction: 1n,
    epochBudget: 1n,
    epochDurationSeconds: 86400n,
    totalBudget: 1n,
    challengeWindowSeconds: 60n,
    counterpartyLabel: "qualification-v5-counterparty",
    agentLabel: "qualification-v5-agent",
  };
}

function mandateArgs(f: Fixture, validFrom: number, expiresAt: number) {
  return ["M-1", f.title, f.purpose, f.constitution, f.permittedActivity, f.forbiddenActivity, f.maximumSingleTransaction, f.epochBudget, f.epochDurationSeconds, f.totalBudget, BigInt(validFrom), BigInt(expiresAt), f.challengeWindowSeconds, f.evidencePolicy, f.authorityConstraints, f.fulfillmentPolicy, f.recoveryPolicy, false];
}

function accounting(value: any, label: string) {
  const item = asRecord(value);
  const deposited = BigInt(item.deposited ?? "0");
  const buckets = ["available", "reserved", "release_pending", "refund_pending", "recovered"];
  const sum = buckets.reduce((total, key) => total + BigInt(item[key] ?? "0"), 0n);
  if (sum !== deposited || item.conserved !== true) throw new Error(`${label} accounting invariant failed`);
  return item;
}

function savePostcondition(state: State, label: string, readback: any) {
  state.steps[label].readback = jsonSafe(readback);
  saveState(state);
}

function deploymentAddress(tx: AnyRecord) {
  const values = [tx?.txDataDecoded?.contractAddress, tx?.data?.contract_address, tx?.data?.contractAddress, tx?.contract_address, tx?.contractAddress, tx?.recipient];
  for (const value of values) {
    const address = preserveAddress(value);
    if (address) return address;
  }
  return "";
}

async function deployedSourceProof(client: AnyRecord, address: string, expectedHash: string) {
  let lastError = "unknown";
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const code = await scheduler.read(`source:${address}`, () => client.getContractCode(address));
      const actualHash = sha256Bytes(new TextEncoder().encode(code));
      if (actualHash !== expectedHash) throw new Error(`deployed source hash mismatch: expected ${expectedHash}, got ${actualHash}`);
      return {address, hash: actualHash, byteLength: Buffer.byteLength(code, "utf8"), exact: true, attempt};
    } catch (error: any) {
      lastError = String(error?.message ?? error);
      if (attempt < 12) await sleep(POLL_MS);
    }
  }
  throw new Error(`deployed source parity did not converge for ${address}: ${lastError}`);
}

function txStatusName(tx: AnyRecord) {
  return String(tx?.statusName ?? tx?.status ?? "UNKNOWN");
}

function txExecutionName(tx: AnyRecord) {
  return String(tx?.txExecutionResultName ?? tx?.execution ?? "UNKNOWN");
}

function txConsensusName(tx: AnyRecord) {
  return String(tx?.resultName ?? tx?.result_name ?? "UNAVAILABLE");
}

function txIsTerminal(tx: AnyRecord) {
  return new Set(["ACCEPTED", "FINALIZED", "REJECTED", "UNDETERMINED", "FAILED", "CANCELLED"]).has(txStatusName(tx));
}

function authAttemptFromTransaction(state: State, tx: AnyRecord, canonicalCommit: boolean, retryPermitted: boolean, executionSuccess?: boolean) {
  const attempts = authorizationAttempts(state);
  const current = attempts[attempts.length - 1];
  if (!current) return;
  updateLatestAuthorizationAttempt(state, {
    attempt: current.attempt,
    tx: current.tx,
    status: txStatusName(tx),
    execution: txExecutionName(tx),
    consensus: txConsensusName(tx),
    execution_success: executionSuccess ?? (tx?.isSuccessful === true || tx?.successful === true),
    canonical_commit: canonicalCommit,
    retry_permitted: retryPermitted,
  });
}

async function executeWrite(context: {client: AnyRecord; account: AnyRecord; state: State; abi: AnyRecord; CalldataAddress: any; retryStep?: string; retryStepsUsed?: Set<string>}, config: {label: string; address: string; functionName: string; args: any[]; value?: bigint; summary?: any[]; precondition?: () => Promise<void>; postcondition: () => Promise<any>}) {
  const {client, account, state, abi, CalldataAddress} = context;
  const {label, address, functionName, args, value = 0n, summary = [], precondition = async () => {}, postcondition} = config;
  const retryStepsUsed = context.retryStepsUsed ?? new Set<string>();
  if (label === AUTHORIZATION_STEP) ensureAuthorizationCheckpoint(state);
  let step = state.steps[label] ??
    state.completedSteps[label] ??
    [...state.submittedTransactions, ...state.failedAttempts].reverse().find((item) => item.label === label);
  if (step?.tx && !state.steps[label]) state.steps[label] = step;

  // A completed step is resumable only after its canonical postcondition was
  // recorded. A hash alone is never evidence that a write completed.
  if (step?.status === "COMPLETE" && step.tx && (label !== AUTHORIZATION_STEP || step.canonical_postcondition_met === true)) {
    const reconciled = await reconcileSameHash({client, hash: step.tx});
    requireSuccessfulExecution(reconciled.tx);
    const readback = await postcondition();
    if (label === AUTHORIZATION_STEP) authAttemptFromTransaction(state, reconciled.tx, true, false, reconciled.successful === true);
    state.steps[label] = {...state.steps[label], execution: txExecutionName(reconciled.tx), terminal_status: txStatusName(reconciled.tx), execution_success: reconciled.successful === true, canonical_postcondition_met: true, retry_permitted: false, readback: jsonSafe(readback)};
    savePostcondition(state, label, readback);
    return {hash: step.tx, tx: reconciled.tx, readback};
  }

  let explicitRetry = label === AUTHORIZATION_STEP && context.retryStep === label && !retryStepsUsed.has(label);
  if (step?.tx) {
    const reconciled = await reconcileSameHash({client, hash: step.tx});
    try {
      requireSuccessfulExecution(reconciled.tx);
      const readback = await postcondition();
      step = {...step, status: "COMPLETE", execution: txExecutionName(reconciled.tx), terminal_status: txStatusName(reconciled.tx), execution_success: reconciled.successful === true, consensus_result: txConsensusName(reconciled.tx), canonical_postcondition_met: true, retry_permitted: false, lifecycle: reconciled.tx.lifecycle, readback: jsonSafe(readback)};
      state.steps[label] = step;
      if (label === AUTHORIZATION_STEP) authAttemptFromTransaction(state, reconciled.tx, true, false, reconciled.successful === true);
      recordComplete(state, step);
      saveState(state);
      appendTransaction({tx: step.tx, operation: label, status: txStatusName(reconciled.tx), execution: txExecutionName(reconciled.tx), consensus: txConsensusName(reconciled.tx), lifecycle: reconciled.tx.lifecycle, readback});
      return {hash: step.tx, tx: reconciled.tx, readback};
    } catch (error: any) {
      const failed = {...step, status: "ERROR", execution: txExecutionName(reconciled.tx), terminal_status: txStatusName(reconciled.tx), execution_success: reconciled.successful === true, consensus_result: txConsensusName(reconciled.tx), canonical_postcondition_met: false, retry_permitted: label === AUTHORIZATION_STEP, lifecycle: reconciled.tx.lifecycle, error: String(error?.message ?? error)};
      state.steps[label] = failed;
      if (label === AUTHORIZATION_STEP) authAttemptFromTransaction(state, reconciled.tx, false, true, reconciled.successful === true);
      recordFailed(state, failed);
      saveState(state);
      appendTransaction({tx: step.tx, operation: label, status: txStatusName(reconciled.tx), execution: txExecutionName(reconciled.tx), consensus: txConsensusName(reconciled.tx), lifecycle: reconciled.tx.lifecycle, error: failed.error});
      if (!(explicitRetry && txIsTerminal(reconciled.tx))) throw error;
      retryStepsUsed.add(label);
      explicitRetry = false;
    }
  }

  if (context.retryStep === label && !retryStepsUsed.has(label) && label === AUTHORIZATION_STEP) {
    throw new Error("Explicit authorization retry was not reached from a persisted terminal attempt");
  }
  await precondition();
  calldataRoundTrip(abi, functionName, args);
  const attemptNumber = label === AUTHORIZATION_STEP ? nextAuthorizationAttemptNumber(state) : undefined;
  step = {label, status: "SUBMITTED", summary, submittedAt: new Date().toISOString(), ...(attemptNumber === undefined ? {} : {attempt_number: attemptNumber, canonical_postcondition_met: false, retry_permitted: false, execution_success: false, consensus_result: "UNAVAILABLE"})};
  const hash = await sendWriteOnce({
    client,
    operation: label,
    request: {address, functionName, args, value, account},
    persistHash: async (txHash) => {
      step = {...step, tx: txHash, tx_hash: txHash};
      state.steps[label] = step;
      if (label === AUTHORIZATION_STEP) appendAuthorizationAttempt(state, {attempt: attemptNumber!, tx: txHash, status: "SUBMITTED", execution: "PENDING", consensus: "UNAVAILABLE", execution_success: false, canonical_commit: false, retry_permitted: false});
      recordSubmitted(state, step);
      saveState(state);
      appendTransaction({tx: txHash, operation: label, functionName, args: summary, value: value.toString(), status: "SUBMITTED", attempt: attemptNumber, submittedAt: step.submittedAt});
      console.log(`TX_SUBMITTED=${label} ${txHash}`);
    },
  });
  const reconciled = await reconcileSameHash({client, hash});
  try {
    requireSuccessfulExecution(reconciled.tx);
    const readback = await postcondition();
    step = {...step, tx: hash, tx_hash: hash, status: "COMPLETE", execution: txExecutionName(reconciled.tx), terminal_status: txStatusName(reconciled.tx), execution_success: reconciled.successful === true, consensus_result: txConsensusName(reconciled.tx), canonical_postcondition_met: true, retry_permitted: false, lifecycle: reconciled.tx.lifecycle, readback: jsonSafe(readback)};
    state.steps[label] = step;
    if (label === AUTHORIZATION_STEP) authAttemptFromTransaction(state, reconciled.tx, true, false, reconciled.successful === true);
    recordComplete(state, step);
    saveState(state);
    appendTransaction({tx: hash, operation: label, functionName, args: summary, value: value.toString(), status: txStatusName(reconciled.tx), execution: txExecutionName(reconciled.tx), consensus: txConsensusName(reconciled.tx), lifecycle: reconciled.tx.lifecycle, readback});
    return {hash, tx: reconciled.tx, readback};
  } catch (error: any) {
    step = {...step, tx: hash, tx_hash: hash, status: "ERROR", execution: txExecutionName(reconciled.tx), terminal_status: txStatusName(reconciled.tx), execution_success: reconciled.successful === true, consensus_result: txConsensusName(reconciled.tx), canonical_postcondition_met: false, retry_permitted: label === AUTHORIZATION_STEP, lifecycle: reconciled.tx.lifecycle, error: String(error?.message ?? error)};
    state.steps[label] = step;
    if (label === AUTHORIZATION_STEP) authAttemptFromTransaction(state, reconciled.tx, false, true, reconciled.successful === true);
    recordFailed(state, step);
    saveState(state);
    appendTransaction({tx: hash, operation: label, functionName, args: summary, value: value.toString(), status: txStatusName(reconciled.tx), execution: txExecutionName(reconciled.tx), consensus: txConsensusName(reconciled.tx), lifecycle: reconciled.tx.lifecycle, error: step.error});
    throw error;
  }
}

async function executeDeploy(context: {client: AnyRecord; account: AnyRecord; state: State}, config: {label: string; sourcePath: string; expectedHash: string; args: any[]; summary: any[]}) {
  const {client, account, state} = context;
  const {label, sourcePath, expectedHash, args, summary} = config;
  let step = state.steps[label];
  if (sha256File(sourcePath) !== expectedHash) throw new Error(`${label} source changed after V5 freeze`);
  if (step?.status === "COMPLETE" && step.tx && step.readback?.address) {
    const reconciled = await reconcileSameHash({client, hash: step.tx});
    requireSuccessfulExecution(reconciled.tx);
    const parity = await deployedSourceProof(client, step.readback.address, expectedHash);
    step.readback = {...step.readback, sourceParity: parity};
    saveState(state);
    return {hash: step.tx, address: step.readback.address, tx: reconciled.tx, readback: step.readback};
  }
  if (step?.tx) {
    const reconciled = await reconcileSameHash({client, hash: step.tx});
    requireSuccessfulExecution(reconciled.tx);
    const address = step.readback?.address || deploymentAddress(reconciled.tx);
    if (!address) throw new Error(`${label} finalized without a deployed address`);
    const parity = await deployedSourceProof(client, address, expectedHash);
    step = {...step, status: "COMPLETE", execution: reconciled.tx.txExecutionResultName, lifecycle: reconciled.tx.lifecycle, readback: {address, sourceParity: parity}};
    state.steps[label] = step;
    recordComplete(state, step);
    if (label === "deploy:core") state.core = address;
    if (label === "deploy:vault") state.vault = address;
    saveState(state);
    appendTransaction({tx: step.tx, operation: label, status: "FINALIZED", execution: reconciled.tx.txExecutionResultName, lifecycle: reconciled.tx.lifecycle, address, readback: step.readback});
    return {hash: step.tx, address, tx: reconciled.tx, readback: step.readback};
  }
  const code = new Uint8Array(readFileSync(sourcePath));
  step = {label, status: "SUBMITTED", summary, submittedAt: new Date().toISOString()};
  const hash = await sendDeployOnce({
    client,
    operation: label,
    request: {code, args, account},
    persistHash: async (txHash) => {
      step = {...step, tx: txHash};
      state.steps[label] = step;
      recordSubmitted(state, step);
      saveState(state);
      appendTransaction({tx: txHash, operation: label, method: "deployContract", args: summary, status: "SUBMITTED", submittedAt: step.submittedAt});
      console.log(`TX_SUBMITTED=${label} ${txHash}`);
    },
  });
  const reconciled = await reconcileSameHash({client, hash});
  try {
    requireSuccessfulExecution(reconciled.tx);
    const address = deploymentAddress(reconciled.tx);
    if (!address) throw new Error(`${label} finalized without an authoritative deployed address`);
    const parity = await deployedSourceProof(client, address, expectedHash);
    step = {...step, tx: hash, status: "COMPLETE", execution: reconciled.tx.txExecutionResultName, lifecycle: reconciled.tx.lifecycle, readback: {address, sourceParity: parity}};
    state.steps[label] = step;
    recordComplete(state, step);
    if (label === "deploy:core") state.core = address;
    if (label === "deploy:vault") state.vault = address;
    saveState(state);
    appendTransaction({tx: hash, operation: label, method: "deployContract", args: summary, status: "FINALIZED", execution: reconciled.tx.txExecutionResultName, lifecycle: reconciled.tx.lifecycle, address, readback: step.readback});
    return {hash, address, tx: reconciled.tx, readback: step.readback};
  } catch (error: any) {
    step = {...step, tx: hash, status: "ERROR", execution: reconciled.tx.txExecutionResultName, lifecycle: reconciled.tx.lifecycle, error: String(error?.message ?? error)};
    state.steps[label] = step;
    recordFailed(state, step);
    saveState(state);
    appendTransaction({tx: hash, operation: label, method: "deployContract", args: summary, status: "FINALIZED", execution: reconciled.tx.txExecutionResultName, lifecycle: reconciled.tx.lifecycle, error: step.error});
    throw error;
  }
}

async function runPreflight(deps: AnyRecord, retryStep = "") {
  const {abi, chains, createClient, CalldataAddress} = deps;
  LATEST_FINAL = deps.TransactionHashVariant?.LATEST_FINAL ?? FALLBACK_LATEST_FINAL;
  const checks: AnyRecord = {};
  const coreBytes = new Uint8Array(readFileSync(CORE_SOURCE));
  const vaultBytes = new Uint8Array(readFileSync(VAULT_SOURCE));
  const coreHash = sha256Bytes(coreBytes);
  const vaultHash = sha256Bytes(vaultBytes);
  if (coreHash !== CORE_SHA) throw new Error(`V5 Core SHA mismatch: expected ${CORE_SHA}, got ${coreHash}`);
  if (vaultHash !== VAULT_SHA) throw new Error(`V5 Vault SHA mismatch: expected ${VAULT_SHA}, got ${vaultHash}`);
  checks.sourceFreeze = {coreSha256: coreHash, coreByteLength: coreBytes.byteLength, vaultSha256: vaultHash, vaultByteLength: vaultBytes.byteLength};
  writeArtifact("source-freeze.json", {...checks.sourceFreeze, frozenAt: new Date().toISOString(), toolchain: {genlayer: "0.39.2", genlayerJs: "1.1.8"}});
  if (chains.studionet.id !== CHAIN_ID || chains.studionet.rpcUrls.default.http[0] !== RPC) throw new Error("Pinned SDK is not stable Studionet 61999");
  checks.network = {network: NETWORK, rpc: RPC, chainId: CHAIN_ID, status: "PASS"};
  const selected = findExpectedKeystore();
  if (selected.name !== EXPECTED_KEYSTORE || !sameAddress(selected.address, EXPECTED_SIGNER)) throw new Error(`Expected V5 keystore ${EXPECTED_KEYSTORE} for ${EXPECTED_SIGNER} was not selected`);
  checks.signer = {address: EXPECTED_SIGNER, keystore: selected.name, passwordDecrypted: false};
  validateEvidenceUrl(EVIDENCE_URL, EVIDENCE_AUTHORITY);
  const evidence = await fetchEvidence();
  checks.evidence = evidence;
  writeArtifact("evidence-preflight.json", {url: EVIDENCE_URL, authority: EVIDENCE_AUTHORITY, ...evidence});

  const readClient = createClient({chain: chains.studionet, endpoint: RPC, account: EXPECTED_SIGNER});
  const chainId = await scheduler.read("chain-id", () => readClient.getChainId());
  if (chainId !== CHAIN_ID) throw new Error(`RPC returned chain ${chainId}, expected ${CHAIN_ID}`);
  const [coreSchema, vaultSchema] = await Promise.all([
    scheduler.read("core-schema-for-code", () => readClient.getContractSchemaForCode(coreBytes)),
    scheduler.read("vault-schema-for-code", () => readClient.getContractSchemaForCode(vaultBytes)),
  ]);
  const coreMethods = requireMethods(coreSchema, ["register_principal", "register_agent", "register_counterparty", "set_vault_address", "create_mandate", "configure_mandate", "seal_mandate", "create_intent", "submit_intent", "define_evidence", "stage_evidence", "authorize_intent", "start_fulfillment", "assess_fulfillment", "get_authorization_for_vault", "get_settlement_instruction"], "Core");
  const vaultMethods = requireMethods(vaultSchema, ["bind_core", "deposit", "reserve", "request_release", "get_accounting", "get_reservation"], "Vault");
  if (!/def __init__\(self\):/.test(new TextDecoder().decode(coreBytes))) throw new Error("Core constructor signature drifted");
  if (!/def __init__\(self, core_address: Address\):/.test(new TextDecoder().decode(vaultBytes))) throw new Error("Vault constructor signature drifted");
  if (!/@gl\.public\.write\.payable\s+def deposit/.test(new TextDecoder().decode(vaultBytes))) throw new Error("Vault deposit is not payable in the frozen source");
  checks.interfaceParity = {coreMethods, vaultMethods, constructorParity: "PASS", depositPayable: true};

  const address = calldataAddress(CalldataAddress, EXPECTED_SIGNER);
  const roundTrips = [
    calldataRoundTrip(abi, "bind_core", []),
    calldataRoundTrip(abi, "set_vault_address", [address]),
    calldataRoundTrip(abi, "register_principal", []),
    calldataRoundTrip(abi, "register_agent", [address, "qualification-v5-agent"]),
    calldataRoundTrip(abi, "create_mandate", [address, ""]),
    calldataRoundTrip(abi, "register_counterparty", [address, "qualification-v5-counterparty", EVIDENCE_URL]),
    calldataRoundTrip(abi, "deposit", ["M-1"]),
    calldataRoundTrip(abi, "create_intent", ["M-1", "C-1", address, MINIMAL_AMOUNT, "qualification-v5 purchase", "purpose", "deliverable", "commercial", "fulfillment", 1n]),
    calldataRoundTrip(abi, "define_evidence", ["I-1", "PRODUCT_SERVICE", EVIDENCE_URL, EVIDENCE_AUTHORITY, evidence.sha256, BigInt(evidence.byteLength), EVIDENCE_AUTHORITY, 0n]),
    calldataRoundTrip(abi, "stage_evidence", ["I-1"]),
    calldataRoundTrip(abi, "authorize_intent", ["I-1"]),
    calldataRoundTrip(abi, "reserve", ["I-1"]),
    calldataRoundTrip(abi, "start_fulfillment", ["I-1"]),
    calldataRoundTrip(abi, "assess_fulfillment", ["I-1"]),
    calldataRoundTrip(abi, "request_release", ["I-1"]),
  ];
  checks.calldata = {status: "PASS", roundTrips};

  const simulation = runSimulation();
  if (simulation?.status !== "PASS") throw new Error("Full local lifecycle simulation did not pass");
  checks.localSimulation = simulation;
  const state = loadState();
  const retryPlan = assertRetryPlan(state, retryStep);
  checks.checkpoint = {version: state.version, existingSteps: Object.keys(state.steps), noHistoricalV4Reuse: !JSON.stringify(state).includes("0x0a6762c46f664751ee5a20d2efb94b979fa8a830")};
  if (!checks.checkpoint.noHistoricalV4Reuse) throw new Error("V5 checkpoint contains historical V4 Core state");
  checks.firstLiveWrite = retryPlan?.firstLiveWrite ?? (Object.keys(state.steps).length === 0 ? "deploy:core" : Object.entries(state.steps).find(([, step]) => step.status !== "COMPLETE")?.[0] ?? "complete");
  checks.noEarlierPhaseReplay = retryPlan?.noEarlierPhaseReplay ?? true;
  checks.explicitRetry = retryStep === "" ? null : {step: retryStep, attemptNumber: retryPlan?.attemptNumber};
  checks.releaseGates = [
    runGate("authoritative-tests", "pnpm", ["test"]),
    runGate("contract-lint", "pnpm", ["contracts:lint"]),
    runGate("contract-compile", "pnpm", ["contracts:compile"]),
    runGate("interface-parity", "python", ["scripts/core-vault-interface-parity.py"]),
    runGate("address-calldata-parity", "python", ["scripts/address-calldata-parity.py"]),
    runGate("frontend-typecheck", "pnpm", ["frontend:typecheck"]),
    runGate("frontend-lint", "pnpm", ["frontend:lint"]),
    runGate("frontend-build", "pnpm", ["frontend:build"]),
    runGate("network-guard", "pnpm", ["network:guard"]),
    runGate("secret-scan", "powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/secret-scan.ps1"]),
  ];
  writeArtifact("preflight.json", {result: "PASS", network: NETWORK, rpc: RPC, chainId: CHAIN_ID, signer: EXPECTED_SIGNER, sourceFreeze: checks.sourceFreeze, evidence, checks, generatedAt: new Date().toISOString(), zeroWrites: true});
  console.log("V5_PREFLIGHT=PASS");
  console.log(`FIRST_LIVE_WRITE=${checks.firstLiveWrite}`);
  console.log(`NO_EARLIER_PHASE_REPLAY=${checks.noEarlierPhaseReplay ? "PASS" : "FAIL"}`);
  console.log("NO_DRAFT_ASSERTION=PASS");
  return {deps, readClient, evidence, checks};
}

async function waitForActivation(client: AnyRecord, mandate: AnyRecord) {
  while (true) {
    const reference = await chainTime(client);
    if (reference.chainNow >= Number(mandate.valid_from) && reference.chainNow < Number(mandate.expires_at)) return reference;
    if (reference.chainNow >= Number(mandate.expires_at)) throw new Error("Mandate expired before activation");
    console.log(`WAITING_FOR_MANDATE_ACTIVATION=${mandate.valid_from}`);
    await sleep(POLL_MS);
  }
}

async function waitForSettlementReady(client: AnyRecord, core: string, intentId: string) {
  while (true) {
    const instruction = asRecord(await read(client, core, "get_settlement_instruction", [intentId]));
    if (instruction.status === "CHALLENGE_BLOCKED" || instruction.oldest_open_challenge) throw new Error("Settlement is blocked by an unresolved qualifying challenge");
    const reference = await chainTime(client);
    if (reference.chainNow >= Number(instruction.ready_at)) return {instruction, reference};
    console.log(`WAITING_FOR_CHALLENGE_WINDOW=${instruction.ready_at}`);
    await sleep(POLL_MS);
  }
}

async function completeLifecycle(preflight: AnyRecord, retryStep = "") {
  const {deps, evidence} = preflight;
  const {abi, chains, createAccount, createClient, CalldataAddress, Wallet, prompt} = deps;
  const selected = findExpectedKeystore();
  const loaded = await loadExistingAccount(Wallet, prompt, selected);
  const signingSecret = loaded.wallet["private" + "Key"];
  const account = createAccount(signingSecret);
  if (!sameAddress(account.address, EXPECTED_SIGNER)) throw new Error("Decrypted signer address mismatch");
  const client = createClient({chain: chains.studionet, endpoint: RPC, account});
  if (typeof client.initializeConsensusSmartContract === "function") await client.initializeConsensusSmartContract();
  const state = loadState();
  const retryPlan = assertRetryPlan(state, retryStep);
  const context = {client, account, state, abi, CalldataAddress, retryStep, retryStepsUsed: new Set<string>()};
  if (retryPlan) {
    console.log(`EXPLICIT_RETRY_STEP=${retryPlan.firstLiveWrite}`);
    console.log(`RETRY_ATTEMPT_NUMBER=${retryPlan.attemptNumber}`);
  }
  const f = fixture();

  let core = state.core ?? "";
  let vault = state.vault ?? "";
  if (!core) {
    const deployed = await executeDeploy({client, account, state}, {label: "deploy:core", sourcePath: CORE_SOURCE, expectedHash: CORE_SHA, args: [], summary: [{type: "source", sha256: CORE_SHA, byteLength: readFileSync(CORE_SOURCE).byteLength}]});
    core = deployed.address;
    state.core = core;
    saveState(state);
  }
  if (!vault) {
    const deployed = await executeDeploy({client, account, state}, {label: "deploy:vault", sourcePath: VAULT_SOURCE, expectedHash: VAULT_SHA, args: [calldataAddress(CalldataAddress, core)], summary: [{type: "constructor_core_address", value: core}]});
    vault = deployed.address;
    state.vault = vault;
    saveState(state);
  }
  if (!sameAddress(await read(client, vault, "get_core_address"), core)) throw new Error("V5 Vault constructor Core binding mismatch");
  const currentCoreVault = String(await read(client, core, "get_vault_address") ?? "");
  if (state.steps["vault:bind_core"]?.status !== "COMPLETE") {
    await executeWrite({...context}, {label: "vault:bind_core", address: vault, functionName: "bind_core", args: [], postcondition: async () => { const value = await read(client, vault, "get_core_address"); if (!sameAddress(value, core)) throw new Error("Vault binding postcondition failed"); return {core}; }});
  }
  if (state.steps["core:set_vault_address"]?.status !== "COMPLETE") {
    if (currentCoreVault !== "" && !/^0x0{40}$/i.test(currentCoreVault)) {
      if (!sameAddress(currentCoreVault, vault)) throw new Error("V5 Core has an unexpected immutable Vault binding without a checkpoint");
    } else {
      await executeWrite({...context}, {label: "core:set_vault_address", address: core, functionName: "set_vault_address", args: [calldataAddress(CalldataAddress, vault)], postcondition: async () => { const value = await read(client, core, "get_vault_address"); if (!sameAddress(value, vault)) throw new Error("Core binding postcondition failed"); return {vault}; }});
    }
  }
  if (!sameAddress(await read(client, core, "get_vault_address"), vault)) throw new Error("V5 bidirectional binding readback failed");
  state.observations.binding = {core, vault, status: "PASS"};
  saveState(state);

  await executeWrite({...context}, {label: "core:register_principal", address: core, functionName: "register_principal", args: [], precondition: async () => { if (!sameAddress(await read(client, core, "get_owner"), EXPECTED_SIGNER)) throw new Error("V5 principal precondition owner mismatch"); }, postcondition: async () => ({registered: true, signer: EXPECTED_SIGNER})});
  await executeWrite({...context}, {label: "core:register_agent", address: core, functionName: "register_agent", args: [calldataAddress(CalldataAddress, EXPECTED_SIGNER), f.agentLabel], precondition: async () => { if (!sameAddress(await read(client, core, "get_owner"), EXPECTED_SIGNER)) throw new Error("V5 agent precondition owner mismatch"); }, postcondition: async () => ({registered: true, agent: EXPECTED_SIGNER, label: f.agentLabel})});

  let mandate = asRecord(await read(client, core, "get_mandate", ["M-1"]));
  if (Object.keys(mandate).length === 0) {
    const create = await executeWrite({...context}, {label: "core:create_mandate", address: core, functionName: "create_mandate", args: [calldataAddress(CalldataAddress, EXPECTED_SIGNER), ""], postcondition: async () => { const item = asRecord(await read(client, core, "get_mandate", ["M-1"])); if (item.mandate_id !== "M-1" || !sameAddress(item.principal, EXPECTED_SIGNER) || !sameAddress(item.authorized_agent, EXPECTED_SIGNER) || item.status !== "DRAFT") throw new Error("V5 root mandate postcondition failed"); return item; }});
    mandate = create.readback;
  }
  if (mandate.status === "DRAFT" && mandate.title === "") {
    const now = await chainTime(client);
    const validFrom = now.chainNow + SEAL_MARGIN_SECONDS;
    const expiresAt = validFrom + QUALIFICATION_HORIZON_SECONDS;
    f.validFrom = validFrom;
    f.expiresAt = expiresAt;
    const configure = await executeWrite({...context}, {label: "core:configure_mandate", address: core, functionName: "configure_mandate", args: mandateArgs(f, validFrom, expiresAt), postcondition: async () => { const item = asRecord(await read(client, core, "get_mandate", ["M-1"])); if (item.status !== "DRAFT" || item.valid_from !== String(validFrom) || item.expires_at !== String(expiresAt)) throw new Error("V5 mandate configure postcondition failed"); return item; }});
    mandate = configure.readback;
  } else {
    f.validFrom = asNumber(mandate.valid_from, "mandate.valid_from");
    f.expiresAt = asNumber(mandate.expires_at, "mandate.expires_at");
  }
  if (mandate.status === "DRAFT") {
    const reference = await chainTime(client);
    const remaining = Number(mandate.valid_from) - reference.chainNow;
    if (remaining < MINIMUM_SAFE_SEAL_REMAINING) {
      const nextValidFrom = reference.chainNow + SEAL_MARGIN_SECONDS;
      const nextExpiresAt = nextValidFrom + QUALIFICATION_HORIZON_SECONDS;
      f.validFrom = nextValidFrom;
      f.expiresAt = nextExpiresAt;
      mandate = (await executeWrite({...context}, {label: "core:configure_mandate:margin-reconfigure", address: core, functionName: "configure_mandate", args: mandateArgs(f, nextValidFrom, nextExpiresAt), postcondition: async () => read(client, core, "get_mandate", ["M-1"])})).readback;
    }
    const sealReference = await chainTime(client);
    if (!(sealReference.chainNow < Number(mandate.valid_from) && Number(mandate.valid_from) - sealReference.chainNow >= MINIMUM_SAFE_SEAL_REMAINING)) throw new Error("Seal window closed or safety margin exhausted before submission");
    mandate = (await executeWrite({...context}, {label: "core:seal_mandate", address: core, functionName: "seal_mandate", args: ["M-1"], postcondition: async () => { const item = asRecord(await read(client, core, "get_mandate", ["M-1"])); if (item.status !== "SEALED" || item.definition_hash === "") throw new Error("V5 mandate seal postcondition failed"); return item; }})).readback;
  }
  if (mandate.status !== "SEALED") throw new Error("V5 mandate did not seal");
  const activation = await waitForActivation(client, mandate);
  state.observations.mandate = {...mandate, activation};
  saveState(state);

  let counterparty = asRecord(await read(client, core, "get_counterparty", ["C-1"]));
  if (Object.keys(counterparty).length === 0) {
    counterparty = (await executeWrite({...context}, {label: "core:register_counterparty", address: core, functionName: "register_counterparty", args: [calldataAddress(CalldataAddress, EXPECTED_SIGNER), f.counterpartyLabel, EVIDENCE_URL], precondition: async () => { if (Object.keys(asRecord(await read(client, core, "get_counterparty", ["C-1"]))).length !== 0) throw new Error("V5 counterparty already exists without a checkpoint"); }, postcondition: async () => { const item = asRecord(await read(client, core, "get_counterparty", ["C-1"])); if (!sameAddress(item.bound_wallet, EXPECTED_SIGNER) || item.label !== f.counterpartyLabel || item.authority_origin !== EVIDENCE_AUTHORITY || item.active !== true) throw new Error("V5 counterparty postcondition failed"); return item; }})).readback;
  }

  let depositAccounting = accounting(await read(client, vault, "get_accounting", ["M-1"]), "pre-deposit");
  if (BigInt(depositAccounting.deposited) === 0n) {
    depositAccounting = accounting((await executeWrite({...context}, {label: "vault:deposit", address: vault, functionName: "deposit", args: ["M-1"], value: MINIMAL_AMOUNT, postcondition: async () => { const item = accounting(await read(client, vault, "get_accounting", ["M-1"]), "deposit"); if (BigInt(item.deposited) !== 1n || BigInt(item.available) !== 1n || BigInt(item.reserved) !== 0n) throw new Error("V5 deposit accounting postcondition failed"); return item; }})).readback);
  } else if (BigInt(depositAccounting.deposited) !== 1n || BigInt(depositAccounting.available) !== 1n) throw new Error("V5 deposit account is not the exact minimal qualification balance");

  const lifecycleNow = await chainTime(client);
  let intent = asRecord(await read(client, core, "get_intent", ["I-1"]));
  const intentExpiresAt = Math.min(f.expiresAt, lifecycleNow.chainNow + 3600);
  if (intentExpiresAt <= lifecycleNow.chainNow) throw new Error("V5 Intent expiry cannot fit inside M-1");
  if (Object.keys(intent).length === 0) {
    intent = (await executeWrite({...context}, {label: "core:create_intent", address: core, functionName: "create_intent", args: ["M-1", "C-1", calldataAddress(CalldataAddress, EXPECTED_SIGNER), MINIMAL_AMOUNT, "qualification-v5 purchase", f.purpose, f.deliverable, f.commercialTerms, f.fulfillmentCriteria, BigInt(intentExpiresAt)], postcondition: async () => { const item = asRecord(await read(client, core, "get_intent", ["I-1"])); if (item.intent_id !== "I-1" || item.status !== "DRAFT" || item.amount !== "1" || item.counterparty_identity_id !== "C-1" || !sameAddress(item.recipient, EXPECTED_SIGNER)) throw new Error("V5 Intent create postcondition failed"); return item; }})).readback;
  }
  if (intent.status === "DRAFT") intent = (await executeWrite({...context}, {label: "core:submit_intent", address: core, functionName: "submit_intent", args: ["I-1"], postcondition: async () => { const item = asRecord(await read(client, core, "get_intent", ["I-1"])); if (item.status !== "SUBMITTED" || item.intent_fingerprint === "") throw new Error("V5 Intent submit postcondition failed"); return item; }})).readback;

  let authEvidence = asRecord(await read(client, core, "get_evidence", ["I-1", 0n]));
  if (Object.keys(authEvidence).length === 0) {
    authEvidence = (await executeWrite({...context}, {label: "core:define_evidence:authorization", address: core, functionName: "define_evidence", args: ["I-1", "PRODUCT_SERVICE", EVIDENCE_URL, EVIDENCE_AUTHORITY, evidence.sha256, BigInt(evidence.byteLength), EVIDENCE_AUTHORITY, 0n], postcondition: async () => { const item = asRecord(await read(client, core, "get_evidence", ["I-1", 0n])); if (item.evidence_id !== "E-1" || item.expected_hash !== evidence.sha256 || item.committed_sha256 !== evidence.sha256 || item.committed_byte_length !== String(evidence.byteLength) || item.identity_fingerprint === "") throw new Error("V5 authorization evidence definition postcondition failed"); return item; }})).readback;
  }
  if (intent.status === "SUBMITTED") {
    await executeWrite({...context}, {label: "core:stage_evidence:authorization", address: core, functionName: "stage_evidence", args: ["I-1"], postcondition: async () => { const item = asRecord(await read(client, core, "get_intent", ["I-1"])); const definition = asRecord(await read(client, core, "get_evidence", ["I-1", 0n])); if (item.status !== "EVIDENCE_READY" || definition.committed_sha256 !== evidence.sha256 || definition.committed_byte_length !== String(evidence.byteLength)) throw new Error("V5 authorization evidence stage postcondition failed"); return {intent: item, evidence: definition}; }});
    intent = asRecord(await read(client, core, "get_intent", ["I-1"]));
  }
  if (intent.status === "EVIDENCE_READY") {
    intent = (await executeWrite({...context}, {label: "core:authorize_intent", address: core, functionName: "authorize_intent", args: ["I-1"], postcondition: async () => {
      const item = asRecord(await read(client, core, "get_intent", ["I-1"]));
      const authorization = asRecord(item.authorization);
      const authorizationRecord = Object.keys(authorization).length > 0 ? "PRESENT" : "MISSING";
      const decision = String(authorization.decision ?? "");
      if (item.status !== "AUTHORIZED" || decision !== "AUTHORIZED") {
        throw new Error("V5 authorization postcondition discrepancy: status=" + (item.status || "MISSING") + " authorization_record=" + authorizationRecord + " decision=" + (decision || "MISSING"));
      }
      return item;
    }})).readback;
  }
  if (retryStep === AUTHORIZATION_STEP) {
    state.observations.authorizationRetry = {
      step: AUTHORIZATION_STEP,
      tx: state.steps[AUTHORIZATION_STEP]?.tx ?? "",
      canonicalPostconditionMet: state.steps[AUTHORIZATION_STEP]?.canonical_postcondition_met === true,
      stoppedBeforeReservation: true,
    };
    saveState(state);
    console.log("AUTHORIZATION_RETRY_ONLY=PASS");
    return;
  }
  if (intent.status !== "AUTHORIZED") throw new Error(`V5 cannot reserve Intent from state ${intent.status}`);

  let reservation = asRecord(await read(client, vault, "get_reservation", ["I-1"]));
  if (Object.keys(reservation).length === 0) {
    reservation = (await executeWrite({...context}, {label: "vault:reserve", address: vault, functionName: "reserve", args: ["I-1"], postcondition: async () => { const item = asRecord(await read(client, vault, "get_reservation", ["I-1"])); const ledger = accounting(await read(client, vault, "get_accounting", ["M-1"]), "reservation"); if (item.status !== "RESERVED" || BigInt(ledger.available) !== 0n || BigInt(ledger.reserved) !== 1n) throw new Error("V5 reservation postcondition failed"); return {reservation: item, accounting: ledger}; }})).readback;
  }
  const unassessedProof = {intentId: "I-2", authorizationState: "NO_AUTHORIZATION_RECORD", result: "UNASSESSED_NOT_CLEARED", noTransactionSubmitted: true, basis: "Vault reserve requires Core status AUTHORIZED and authorization_decision AUTHORIZED"};
  writeArtifact("unassessed-not-cleared-proof.json", unassessedProof);
  state.observations.unassessedProof = unassessedProof;
  saveState(state);

  if (intent.status === "AUTHORIZED") intent = (await executeWrite({...context}, {label: "core:start_fulfillment", address: core, functionName: "start_fulfillment", args: ["I-1"], postcondition: async () => { const item = asRecord(await read(client, core, "get_intent", ["I-1"])); if (item.status !== "FULFILLMENT_PENDING") throw new Error("V5 fulfillment start postcondition failed"); return item; }})).readback;
  let fulfillmentEvidence = asRecord(await read(client, core, "get_evidence", ["I-1", 1n]));
  if (Object.keys(fulfillmentEvidence).length === 0) {
    fulfillmentEvidence = (await executeWrite({...context}, {label: "core:define_evidence:fulfillment", address: core, functionName: "define_evidence", args: ["I-1", "FULFILLMENT", EVIDENCE_URL, EVIDENCE_AUTHORITY, evidence.sha256, BigInt(evidence.byteLength), EVIDENCE_AUTHORITY, 1n], postcondition: async () => { const item = asRecord(await read(client, core, "get_evidence", ["I-1", 1n])); if (item.evidence_id !== "E-2" || item.committed_sha256 !== evidence.sha256 || item.committed_byte_length !== String(evidence.byteLength) || item.identity_fingerprint === "") throw new Error("V5 fulfillment evidence definition postcondition failed"); return item; }})).readback;
  }
  intent = asRecord(await read(client, core, "get_intent", ["I-1"]));
  if (intent.status === "FULFILLMENT_PENDING") {
    await executeWrite({...context}, {label: "core:stage_evidence:fulfillment", address: core, functionName: "stage_evidence", args: ["I-1"], postcondition: async () => { const item = asRecord(await read(client, core, "get_intent", ["I-1"])); const definition = asRecord(await read(client, core, "get_evidence", ["I-1", 1n])); if (definition.committed_sha256 !== evidence.sha256 || definition.identity_fingerprint === "") throw new Error("V5 fulfillment evidence stage postcondition failed"); return {intent: item, evidence: definition}; }});
  }
  intent = asRecord(await read(client, core, "get_intent", ["I-1"]));
  if (intent.status === "FULFILLMENT_PENDING") {
    intent = (await executeWrite({...context}, {label: "core:assess_fulfillment", address: core, functionName: "assess_fulfillment", args: ["I-1"], postcondition: async () => { const item = asRecord(await read(client, core, "get_intent", ["I-1"])); if (item.status !== "FULFILLED") throw new Error(`V5 fulfillment result is ${item.status}, not FULFILLED`); const result = asRecord(item.fulfillment); if (asRecord(result).vector?.outcome !== "FULFILLED") throw new Error("V5 fulfillment vector is not FULFILLED"); return item; }})).readback;
  }
  if (intent.status !== "FULFILLED") throw new Error(`V5 cannot authorize settlement from state ${intent.status}`);
  const settlementReady = await waitForSettlementReady(client, core, "I-1");
  state.observations.settlementAuthorization = {status: "READY", instruction: settlementReady.instruction, chainTime: settlementReady.reference};
  saveState(state);
  let release = state.steps["vault:request_release"];
  let releaseReadback: AnyRecord;
  if (release?.status === "COMPLETE") releaseReadback = release.readback;
  else releaseReadback = (await executeWrite({...context}, {label: "vault:request_release", address: vault, functionName: "request_release", args: ["I-1"], postcondition: async () => { const reservationItem = asRecord(await read(client, vault, "get_reservation", ["I-1"])); const ledger = accounting(await read(client, vault, "get_accounting", ["M-1"]), "release"); if (reservationItem.status !== "RELEASE_PENDING" || BigInt(ledger.release_pending) !== 1n || BigInt(ledger.reserved) !== 0n) throw new Error("V5 release accounting postcondition failed"); return {reservation: reservationItem, accounting: ledger}; }})).readback;
  const releaseTx = state.steps["vault:request_release"]?.tx;
  let childIds: string[] = [];
  let externalObservation = "UNCONFIRMED";
  if (releaseTx) {
    try {
      childIds = await getTriggeredTransactionIds({client, hash: releaseTx});
      const children = [];
      for (const child of childIds) {
        const childReconciled = await reconcileSameHash({client, hash: child});
        children.push({hash: child, status: childReconciled.tx.statusName, execution: childReconciled.tx.txExecutionResultName, successful: childReconciled.successful});
      }
      writeArtifact("external-message-observation.json", {parent: releaseTx, childTransactionIds: childIds, children});
      if (children.length > 0 && children.every((child) => child.successful)) externalObservation = "CONFIRMED";
    } catch (error: any) {
      writeArtifact("external-message-observation.json", {parent: releaseTx, childTransactionIds: childIds, status: "UNCONFIRMED", error: String(error?.message ?? error)});
    }
  }
  const finalAccounting = accounting(await read(client, vault, "get_accounting", ["M-1"]), "final");
  if (BigInt(finalAccounting.deposited) !== 1n || BigInt(finalAccounting.available) !== 0n || BigInt(finalAccounting.reserved) !== 0n || BigInt(finalAccounting.release_pending) !== 1n) throw new Error("V5 final accounting does not match the source-defined pending-release model");
  state.observations.final = {mandate, counterparty, depositAccounting, intent: asRecord(await read(client, core, "get_intent", ["I-1"])), release: releaseReadback, finalAccounting, externalObservation, childTransactionIds: childIds};
  saveState(state);
  writeArtifact("final-report.json", {qualification: "V5", core, vault, state: state.observations, externalObservation, childTransactionIds: childIds});
  console.log("QUALIFICATION_V5_RESULT=PASS");
}

async function main() {
  const deps = await loadPinnedDependencies();
  const retryStep = parseRetryStep(process.argv);
  const preflight = await runPreflight(deps, retryStep);
  if (process.argv.includes("--preflight-only")) return;
  await completeLifecycle(preflight, retryStep);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

export {runPreflight, validateEvidenceUrl, calldataRoundTrip, fixture};
