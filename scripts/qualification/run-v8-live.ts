import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  EXPECTED_SIGNER,
  findExpectedKeystore,
  loadExistingAccount,
  loadKeychainAccount,
  loadPinnedDependencies,
} from "./create-root-mandate.ts";
import {
  FALLBACK_LATEST_FINAL,
  getTriggeredTransactionIds,
  isSuccessful,
  reconcileSameHash,
  requireSuccessfulExecution,
  sendDeployOnce,
  sendWriteOnce,
} from "./lib/official-transaction.ts";

/**
 * Fresh V8 qualification runner.
 *
 * This runner intentionally has its own checkpoint namespace and lifecycle
 * orchestration. It reuses only the pinned dependency loader, expected-address
 * signer resolution, and the official transaction adapter. Every write is
 * broadcast once, persisted before reconciliation, and followed by a
 * LATEST_FINAL business readback.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RPC = "https://studio.genlayer.com/api";
const NETWORK = "studionet";
const CHAIN_ID = 61999;
const EXPECTED_KEYSTORE = "meritround-v2-studionet";
const CORE_SOURCE = path.join(ROOT, "contracts", "pavel_core.py");
const VAULT_SOURCE = path.join(ROOT, "contracts", "pavel_vault.py");
const CORE_SHA = "1636cc81461b5536103add686586308a05f599740a4e625e00825d8d11401e60";
const VAULT_SHA = "f671005e07a658a17a7711807d23fa56bf0d6e2e85d0a266eafc17b03455f15c";
const SOURCE_COMMIT = "6819759400b3685d94c4a700433ba685f639a3dd";
const EVIDENCE_COMMIT = "555b0d62f8c854913b8591204d854c608756a46c";
const RAW_BASE = `https://raw.githubusercontent.com/GIFTEDLOV/pavel/${EVIDENCE_COMMIT}`;
const AUTH_URL = `${RAW_BASE}/docs/ARCHITECTURE.md`;
const AUTHORITY = "raw.githubusercontent.com";
const CHALLENGE_URL = `${RAW_BASE}/docs/EVIDENCE_MODEL.md`;
const AMOUNT = 1n;
const POLL_MS = 5000;
const MANDATE_ACTIVATION_MARGIN = 90;
const MANDATE_HORIZON = 86400;
const CHALLENGE_WINDOW = 120;
const ARTIFACT_DIR = path.join(ROOT, "artifacts", "studionet", "qualification-v8");
const PROOF_DIR = path.join(ROOT, "deployments", "studionet", "qualification-v8");
const STATE_PATH = path.join(ARTIFACT_DIR, "checkpoint.json");
const JOURNAL_PATH = path.join(ARTIFACT_DIR, "transactions.json");

type AnyRecord = Record<string, any>;
type State = AnyRecord;
type EvidenceDescriptor = {label: string; kind: string; url: string; authority: string};

const AUTH_EVIDENCE: EvidenceDescriptor = {label: "authorization-product-service", kind: "PRODUCT_SERVICE", url: AUTH_URL, authority: AUTHORITY};
const FULFILLMENT_EVIDENCE: EvidenceDescriptor = {label: "fulfillment", kind: "FULFILLMENT", url: AUTH_URL, authority: AUTHORITY};
const CHALLENGE_EVIDENCE: EvidenceDescriptor = {label: "challenge", kind: "CHALLENGE", url: CHALLENGE_URL, authority: AUTHORITY};

function jsonSafe(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    const result: AnyRecord = {};
    for (const [key, item] of Object.entries(value)) result[key] = jsonSafe(item);
    return result;
  }
  return value;
}

function saveJson(filePath: string, value: any) {
  mkdirSync(path.dirname(filePath), {recursive: true});
  writeFileSync(filePath, `${JSON.stringify(jsonSafe(value), null, 2)}\n`);
}

function appendJournal(entry: AnyRecord) {
  const entries = existsSync(JOURNAL_PATH) ? JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) : [];
  entries.push(jsonSafe({...entry, recordedAt: new Date().toISOString()}));
  saveJson(JOURNAL_PATH, entries);
}

function sha256Bytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(filePath: string) {
  return sha256Bytes(new Uint8Array(readFileSync(filePath)));
}

function sameAddress(left: unknown, right: unknown) {
  const a = String(left ?? "").toLowerCase();
  const b = String(right ?? "").toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(a) && a === b;
}

function asRecord(value: any): AnyRecord {
  if (typeof value === "string") {
    if (value === "") return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value: any) {
  return typeof value === "string" ? value : String(value ?? "");
}

function txStatus(tx: AnyRecord) {
  return text(tx?.statusName ?? tx?.status).toUpperCase();
}

function txExecution(tx: AnyRecord) {
  return text(tx?.txExecutionResultName ?? tx?.execution).toUpperCase();
}

function txConsensus(tx: AnyRecord) {
  return text(tx?.resultName ?? tx?.result_name).toUpperCase() || "UNAVAILABLE";
}

function deploymentAddress(tx: AnyRecord) {
  for (const value of [tx?.txDataDecoded?.contractAddress, tx?.data?.contract_address, tx?.data?.contractAddress, tx?.contract_address, tx?.contractAddress, tx?.recipient]) {
    if (/^0x[0-9a-f]{40}$/i.test(String(value ?? ""))) return String(value);
  }
  return "";
}

function calldataAddress(CalldataAddress: any, address: string) {
  return new CalldataAddress(Uint8Array.from(Buffer.from(address.slice(2), "hex")));
}

function calldataRoundTrip(abi: AnyRecord, functionName: string, args: any[]) {
  const object = abi.calldata.makeCalldataObject(functionName, args, undefined);
  const encoded = abi.calldata.encode(object);
  if (!encoded || encoded.length === 0) throw new Error(`empty calldata for ${functionName}`);
  return abi.calldata.toString(abi.calldata.decode(encoded));
}

function emptyState(): State {
  return {
    version: "qualification-v8",
    network: NETWORK,
    rpc: RPC,
    chainId: CHAIN_ID,
    signer: EXPECTED_SIGNER.toLowerCase(),
    sourceCommit: SOURCE_COMMIT,
    sourceHashes: {core: CORE_SHA, vault: VAULT_SHA},
    steps: {},
    observations: {},
  };
}

function saveState(state: State) {
  saveJson(STATE_PATH, state);
}

function loadState() {
  if (!existsSync(STATE_PATH)) return emptyState();
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  if (state.version !== "qualification-v8" || state.network !== NETWORK || state.rpc !== RPC || state.chainId !== CHAIN_ID || text(state.signer).toLowerCase() !== EXPECTED_SIGNER.toLowerCase()) {
    throw new Error("V8 checkpoint identity mismatch");
  }
  if (state.sourceHashes?.core !== CORE_SHA || state.sourceHashes?.vault !== VAULT_SHA || state.sourceCommit !== SOURCE_COMMIT) {
    throw new Error("V8 checkpoint source identity mismatch");
  }
  return state;
}

async function chainTime(client: AnyRecord) {
  const block = await client.request({method: "eth_getBlockByNumber", params: ["latest", false]});
  const raw = block?.timestamp;
  const value = typeof raw === "string" && raw.startsWith("0x") ? Number.parseInt(raw.slice(2), 16) : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Studionet chain timestamp unavailable");
  return {chainNow: value, blockNumber: block?.number ?? null};
}

async function waitForChainTime(client: AnyRecord, target: number, label: string) {
  while (true) {
    const current = await chainTime(client);
    const remaining = target - current.chainNow;
    if (remaining <= 0) return current;
    console.log(`WAITING_FOR_${label}=${remaining}`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_MS, Math.max(1000, remaining * 1000))));
  }
}

async function readLatest(client: AnyRecord, address: string, functionName: string, args: any[], latestFinal: any) {
  return client.readContract({address, functionName, args, transactionHashVariant: latestFinal});
}

async function fetchEvidence(descriptor: EvidenceDescriptor) {
  const response = await fetch(descriptor.url, {redirect: "follow"});
  const bytes = new Uint8Array(await response.arrayBuffer());
  const result = {
    label: descriptor.label,
    kind: descriptor.kind,
    url: descriptor.url,
    authority: descriptor.authority,
    status: response.status,
    finalUrl: response.url,
    contentType: response.headers.get("content-type") ?? "",
    sha256: sha256Bytes(bytes),
    byteLength: bytes.byteLength,
  };
  if (result.status !== 200 || result.finalUrl !== descriptor.url || result.authority !== new URL(descriptor.url).hostname || result.byteLength <= 0 || result.byteLength > 4096) {
    throw new Error(`Evidence preflight failed: ${JSON.stringify(result)}`);
  }
  saveJson(path.join(ARTIFACT_DIR, `evidence-${descriptor.label}.json`), result);
  return result;
}

async function sourceProof(client: AnyRecord, address: string, expectedHash: string) {
  const code = await client.getContractCode(address);
  const actual = sha256Bytes(new TextEncoder().encode(code));
  if (actual !== expectedHash) throw new Error(`Deployed source mismatch at ${address}: expected ${expectedHash}, got ${actual}`);
  return {address, sha256: actual, byteLength: Buffer.byteLength(code, "utf8")};
}

function markSubmitted(state: State, label: string, step: AnyRecord, hash: string) {
  step.tx = hash;
  step.tx_hash = hash;
  state.steps[label] = step;
  saveState(state);
  appendJournal({operation: label, tx: hash, status: "SUBMITTED", args: step.summary ?? []});
  console.log(`TX_SUBMITTED=${label} ${hash}`);
}

async function executeWrite({client, account, state, abi, label, address, functionName, args, value = 0n, summary = [], precondition = async () => {}, postcondition}: AnyRecord) {
  const existing = state.steps[label];
  if (existing?.tx) {
    const reconciled = await reconcileSameHash({client, hash: existing.tx, interval: POLL_MS});
    requireSuccessfulExecution(reconciled.tx);
    const readback = await postcondition();
    state.steps[label] = {...existing, status: "COMPLETE", terminal_status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), consensus_result: txConsensus(reconciled.tx), execution_success: true, canonical_postcondition_met: true, readback: jsonSafe(readback)};
    saveState(state);
    return {hash: existing.tx, tx: reconciled.tx, readback};
  }
  await precondition();
  calldataRoundTrip(abi, functionName, args);
  const step = {label, status: "SUBMITTED", submittedAt: new Date().toISOString(), summary};
  const hash = await sendWriteOnce({client, operation: label, request: {address, functionName, args, value, account}, persistHash: async (txHash) => markSubmitted(state, label, step, txHash)});
  const reconciled = await reconcileSameHash({client, hash, interval: POLL_MS});
  if (!isSuccessful(reconciled.tx)) {
    state.steps[label] = {...step, tx: hash, tx_hash: hash, status: "ERROR", terminal_status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), consensus_result: txConsensus(reconciled.tx), execution_success: false};
    saveState(state);
    throw new Error(`${label} failed: status=${txStatus(reconciled.tx)} execution=${txExecution(reconciled.tx)} consensus=${txConsensus(reconciled.tx)}`);
  }
  const readback = await postcondition();
  state.steps[label] = {...step, tx: hash, tx_hash: hash, status: "COMPLETE", terminal_status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), consensus_result: txConsensus(reconciled.tx), execution_success: true, canonical_postcondition_met: true, readback: jsonSafe(readback)};
  saveState(state);
  appendJournal({operation: label, tx: hash, status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), consensus: txConsensus(reconciled.tx), readback});
  return {hash, tx: reconciled.tx, readback};
}

async function executeDeploy({client, account, state, label, sourcePath, expectedHash, args}: AnyRecord) {
  if (sha256File(sourcePath) !== expectedHash) throw new Error(`${label} source changed after V8 freeze`);
  const existing = state.steps[label];
  if (existing?.tx) {
    const reconciled = await reconcileSameHash({client, hash: existing.tx, interval: POLL_MS});
    requireSuccessfulExecution(reconciled.tx);
    const address = existing.address || deploymentAddress(reconciled.tx);
    if (!address) throw new Error(`${label} has no authoritative deployed address`);
    const proof = await sourceProof(client, address, expectedHash);
    state.steps[label] = {...existing, status: "COMPLETE", address, readback: proof};
    saveState(state);
    return {hash: existing.tx, address, tx: reconciled.tx, readback: proof};
  }
  const step = {label, status: "SUBMITTED", submittedAt: new Date().toISOString(), summary: [{type: "source", sha256: expectedHash}]};
  const code = new Uint8Array(readFileSync(sourcePath));
  const hash = await sendDeployOnce({client, operation: label, request: {code, args, account}, persistHash: async (txHash) => markSubmitted(state, label, step, txHash)});
  const reconciled = await reconcileSameHash({client, hash, interval: POLL_MS});
  requireSuccessfulExecution(reconciled.tx);
  const address = deploymentAddress(reconciled.tx);
  if (!address) throw new Error(`${label} finalized without an authoritative address`);
  const proof = await sourceProof(client, address, expectedHash);
  state.steps[label] = {...step, tx: hash, tx_hash: hash, status: "COMPLETE", terminal_status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), consensus_result: txConsensus(reconciled.tx), execution_success: true, canonical_postcondition_met: true, address, readback: proof};
  saveState(state);
  appendJournal({operation: label, tx: hash, status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), consensus: txConsensus(reconciled.tx), address, readback: proof});
  return {hash, address, tx: reconciled.tx, readback: proof};
}

async function readChallenge(client: AnyRecord, core: string, intentId: string, challengeId: string, latestFinal: any) {
  const dispute = asRecord(await readLatest(client, core, "get_dispute", [challengeId], latestFinal));
  const evidenceCount = Number(await readLatest(client, core, "get_challenge_count", [intentId], latestFinal).catch(() => 0));
  const evidence: AnyRecord[] = [];
  const challengeEvidenceCount = Number(dispute.evidence_ids ? String(dispute.evidence_ids).split(",").filter(Boolean).length : 0);
  for (let sequence = 0; sequence < challengeEvidenceCount; sequence += 1) {
    evidence.push(asRecord(await readLatest(client, core, "get_challenge_evidence", [challengeId, BigInt(sequence)], latestFinal)));
  }
  const snapshot = dispute.independent_snapshot_id ? asRecord(await readLatest(client, core, "get_snapshot", [dispute.independent_snapshot_id], latestFinal)) : {};
  return {dispute, evidenceCount, challengeEvidenceCount, evidence, snapshot};
}

async function preflight(deps: AnyRecord, state: State) {
  const coreHash = sha256File(CORE_SOURCE);
  const vaultHash = sha256File(VAULT_SOURCE);
  if (coreHash !== CORE_SHA || vaultHash !== VAULT_SHA) throw new Error(`V8 source drift: core=${coreHash} vault=${vaultHash}`);
  if (deps.chains.studionet.id !== CHAIN_ID || deps.chains.studionet.rpcUrls.default.http[0] !== RPC) throw new Error("Pinned SDK Studionet definition mismatch");
  const selected = findExpectedKeystore();
  if (selected.name !== EXPECTED_KEYSTORE || !sameAddress(selected.address, EXPECTED_SIGNER)) throw new Error("Expected deployment signer profile is not selected");
  const evidence = {
    authorization: await fetchEvidence(AUTH_EVIDENCE),
    fulfillment: await fetchEvidence(FULFILLMENT_EVIDENCE),
    challenge: await fetchEvidence(CHALLENGE_EVIDENCE),
  };
  if (evidence.authorization.sha256 !== evidence.fulfillment.sha256 || evidence.authorization.byteLength !== evidence.fulfillment.byteLength) throw new Error("Authorization and fulfillment commitments are not identical");
  const client = deps.createClient({chain: deps.chains.studionet, endpoint: RPC, account: EXPECTED_SIGNER});
  const chainId = await client.getChainId();
  if (chainId !== CHAIN_ID) throw new Error(`RPC chain id is ${chainId}, expected ${CHAIN_ID}`);
  const balance = await client.getBalance({address: EXPECTED_SIGNER});
  const nonce = await client.getCurrentNonce({address: EXPECTED_SIGNER});
  const rawTxs = await client.request({method: "sim_getTransactionsForAddress", params: [EXPECTED_SIGNER]});
  const txs = Array.isArray(rawTxs) ? rawTxs : [];
  const terminal = new Set(["FINALIZED", "ACCEPTED", "REJECTED", "UNDETERMINED", "FAILED", "CANCELLED"]);
  const pending = txs.filter((item: AnyRecord) => !terminal.has(text(item?.statusName ?? item?.status).toUpperCase())).map((item: AnyRecord) => ({hash: item.hash, status: item.statusName ?? item.status}));
  if (pending.length) throw new Error(`Unknown pending transactions exist: ${JSON.stringify(pending)}`);
  if (BigInt(balance) < AMOUNT) throw new Error("Qualification signer has insufficient GEN");
  state.observations.preflight = {network: NETWORK, rpc: RPC, chainId, signer: EXPECTED_SIGNER.toLowerCase(), keystore: selected.name, balance: String(balance), latestNonce: String(nonce), pendingTransactions: pending, evidence};
  saveState(state);
  return {client, evidence, selected};
}

async function run() {
  const deps = await loadPinnedDependencies();
  const state = loadState();
  const latestFinal = deps.TransactionHashVariant?.LATEST_FINAL ?? FALLBACK_LATEST_FINAL;
  const {abi, chains, createAccount, createClient, CalldataAddress} = deps;
  const {client: readClient, evidence} = await preflight(deps, state);
  console.log(JSON.stringify({version: "V8", network: NETWORK, chainId: CHAIN_ID, sourceCommit: SOURCE_COMMIT, coreSha256: CORE_SHA, vaultSha256: VAULT_SHA, signer: EXPECTED_SIGNER.toLowerCase(), evidence}, null, 2));
  if (process.argv.includes("--preflight-only")) return;

  let loaded: AnyRecord;
  try {
    loaded = await loadKeychainAccount(deps.Wallet, EXPECTED_KEYSTORE, EXPECTED_SIGNER);
  } catch (error) {
    console.log(`KEYCHAIN_SIGNER_UNAVAILABLE=${String((error as Error)?.message ?? error).replaceAll("\n", " ")}`);
    loaded = await loadExistingAccount(deps.Wallet, deps.prompt);
  }
  const account = createAccount(loaded.wallet["private" + "Key"]);
  if (!sameAddress(account.address, EXPECTED_SIGNER)) throw new Error("Resolved signer address mismatch");
  const client = createClient({chain: chains.studionet, endpoint: RPC, account});

  const coreDeploy = await executeDeploy({client, account, state, label: "deploy:v8-core", sourcePath: CORE_SOURCE, expectedHash: CORE_SHA, args: []});
  const core = coreDeploy.address;
  state.core = core;
  saveState(state);
  const vaultDeploy = await executeDeploy({client, account, state, label: "deploy:v8-vault", sourcePath: VAULT_SOURCE, expectedHash: VAULT_SHA, args: [calldataAddress(CalldataAddress, core)]});
  const vault = vaultDeploy.address;
  state.vault = vault;
  saveState(state);
  if (!sameAddress(await readLatest(client, vault, "get_core_address", [], latestFinal), core)) throw new Error("V8 Vault constructor binding mismatch");

  await executeWrite({client, account, state, abi, label: "vault:bind_core", address: vault, functionName: "bind_core", args: [], postcondition: async () => ({core: await readLatest(client, vault, "get_core_address", [], latestFinal)})});
  await executeWrite({client, account, state, abi, label: "core:set_vault_address", address: core, functionName: "set_vault_address", args: [calldataAddress(CalldataAddress, vault)], postcondition: async () => ({vault: await readLatest(client, core, "get_vault_address", [], latestFinal)})});
  const boundCore = await readLatest(client, core, "get_vault_address", [], latestFinal);
  const boundVault = await readLatest(client, vault, "get_core_address", [], latestFinal);
  if (!sameAddress(boundCore, vault) || !sameAddress(boundVault, core)) throw new Error("V8 bidirectional binding mismatch");
  state.observations.binding = {core, vault, coreToVault: boundCore, vaultToCore: boundVault, verified: true};
  saveState(state);

  const counterpartyId = "C-1";
  const mandateId = "M-1";
  const intentId = "I-1";
  await executeWrite({client, account, state, abi, label: "core:register_principal", address: core, functionName: "register_principal", args: [], postcondition: async () => ({mandateCount: String(await readLatest(client, core, "get_mandate_count", [], latestFinal))})});
  await executeWrite({client, account, state, abi, label: "core:register_agent", address: core, functionName: "register_agent", args: [calldataAddress(CalldataAddress, EXPECTED_SIGNER), "PAVEL V8 qualification agent"], postcondition: async () => ({agentRegistration: "committed", mandateCount: String(await readLatest(client, core, "get_mandate_count", [], latestFinal))})});
  state.observations.failedInputAttempt = {label: "core:register_counterparty", tx: state.steps["core:register_counterparty"]?.tx ?? "", execution: state.steps["core:register_counterparty"]?.execution ?? "FINISHED_WITH_ERROR", stateMutation: "NONE", reason: "Runner preflight passed a bare host where the contract requires an HTTPS authority URL; corrected without replaying the failed hash."};
  saveState(state);
  await executeWrite({client, account, state, abi, label: "core:register_counterparty:corrected", address: core, functionName: "register_counterparty", args: [calldataAddress(CalldataAddress, EXPECTED_SIGNER), "PAVEL V8 raw GitHub evidence authority", AUTH_URL], postcondition: async () => asRecord(await readLatest(client, core, "get_counterparty", [counterpartyId], latestFinal))});
  const beforeMandate = await chainTime(client);
  const validFrom = beforeMandate.chainNow + MANDATE_ACTIVATION_MARGIN;
  const expiresAt = validFrom + MANDATE_HORIZON;
  await executeWrite({client, account, state, abi, label: "core:create_mandate", address: core, functionName: "create_mandate", args: [calldataAddress(CalldataAddress, EXPECTED_SIGNER), ""], postcondition: async () => asRecord(await readLatest(client, core, "get_mandate", [mandateId], latestFinal))});
  const mandateArgs = [mandateId, "PAVEL V8 challenge and fulfillment qualification", "Authorize bounded retrieval, authentication, fulfillment review, and challenge review for the exact immutable protocol artifact.", "The principal retains control; the registered agent may submit only the bounded intent.", "Retrieve, authenticate, and deliver the exact committed PAVEL protocol artifact identified by URL, SHA-256, and byte length.", "No unrelated activity, recipient change, budget expansion, substitution, or external transfer beyond exact artifact delivery and protocol challenge review.", AMOUNT, AMOUNT, 86400n, AMOUNT, BigInt(validFrom), BigInt(expiresAt), BigInt(CHALLENGE_WINDOW), "Authenticated HTTPS evidence with the committed URL, SHA-256, and byte length is required for authorization and fulfillment; challenge evidence must be independently authenticated.", AUTHORITY, "Fulfillment requires the complete authenticated artifact with its committed identity; a qualifying challenge may block settlement until resolution or expiry.", "Use only the approved raw.githubusercontent.com authority; unresolved fulfillment expires to refund.", false];
  await executeWrite({client, account, state, abi, label: "core:configure_mandate", address: core, functionName: "configure_mandate", args: mandateArgs, postcondition: async () => asRecord(await readLatest(client, core, "get_mandate", [mandateId], latestFinal))});
  await executeWrite({client, account, state, abi, label: "core:seal_mandate", address: core, functionName: "seal_mandate", args: [mandateId], precondition: async () => { const now = await chainTime(client); if (validFrom - now.chainNow < 20) throw new Error("Mandate activation margin is too small to seal safely"); }, postcondition: async () => asRecord(await readLatest(client, core, "get_mandate", [mandateId], latestFinal))});
  const sealed = asRecord(await readLatest(client, core, "get_mandate", [mandateId], latestFinal));
  if (sealed.status !== "SEALED") throw new Error(`V8 mandate did not seal: ${sealed.status}`);
  await executeWrite({client, account, state, abi, label: "vault:deposit", address: vault, functionName: "deposit", args: [mandateId], value: AMOUNT, postcondition: async () => asRecord(await readLatest(client, vault, "get_accounting", [mandateId], latestFinal))});
  await waitForChainTime(client, validFrom, "MANDATE_ACTIVATION");

  const artifactIdentity = `exact immutable PAVEL artifact URL=${AUTH_URL}; sha256=${evidence.authorization.sha256}; byte_length=${evidence.authorization.byteLength}`;
  const intentExpiry = Math.min(expiresAt, (await chainTime(client)).chainNow + 7200);
  await executeWrite({client, account, state, abi, label: "core:create_intent", address: core, functionName: "create_intent", args: [mandateId, counterpartyId, calldataAddress(CalldataAddress, EXPECTED_SIGNER), AMOUNT, "Exact immutable PAVEL protocol artifact", `Retrieve and deliver ${artifactIdentity}.`, `Completion requires the complete authenticated artifact ${artifactIdentity}.`, "Exactly one smallest native GEN unit; no commercial expansion or substitution.", "The complete committed artifact must be authenticated and match the exact identity.", BigInt(intentExpiry)], postcondition: async () => asRecord(await readLatest(client, core, "get_intent", [intentId], latestFinal))});
  await executeWrite({client, account, state, abi, label: "core:submit_intent", address: core, functionName: "submit_intent", args: [intentId], postcondition: async () => asRecord(await readLatest(client, core, "get_intent", [intentId], latestFinal))});
  await executeWrite({client, account, state, abi, label: "core:define_evidence:authorization", address: core, functionName: "define_evidence", args: [intentId, AUTH_EVIDENCE.kind, AUTH_EVIDENCE.url, AUTHORITY, evidence.authorization.sha256, BigInt(evidence.authorization.byteLength), AUTHORITY, 0n], postcondition: async () => asRecord(await readLatest(client, core, "get_evidence", [intentId, 0n], latestFinal))});
  await executeWrite({client, account, state, abi, label: "core:stage_evidence:authorization", address: core, functionName: "stage_evidence", args: [intentId], postcondition: async () => { const item = asRecord(await readLatest(client, core, "get_intent", [intentId], latestFinal)); if (item.status !== "EVIDENCE_READY") throw new Error(`Authorization evidence did not authenticate: ${item.status}`); return {intent: item, snapshot: await readLatest(client, core, "get_snapshot", [item.current_snapshot_id], latestFinal)}; }});
  const auth = await executeWrite({client, account, state, abi, label: "core:authorize_intent", address: core, functionName: "authorize_intent", args: [intentId], postcondition: async () => { const item = asRecord(await readLatest(client, core, "get_intent", [intentId], latestFinal)); const authorization = asRecord(item.authorization); if (item.status !== "AUTHORIZED" || authorization.decision !== "AUTHORIZED") throw new Error(`Authorization business result was not AUTHORIZED: ${item.status}/${authorization.decision}`); return item; }});
  await executeWrite({client, account, state, abi, label: "vault:reserve", address: vault, functionName: "reserve", args: [intentId], postcondition: async () => { const reservation = asRecord(await readLatest(client, vault, "get_reservation", [intentId], latestFinal)); const accounting = asRecord(await readLatest(client, vault, "get_accounting", [mandateId], latestFinal)); if (reservation.status !== "RESERVED" || accounting.available !== "0" || accounting.reserved !== "1") throw new Error("V8 reservation postcondition failed"); return {reservation, accounting}; }});
  await executeWrite({client, account, state, abi, label: "core:start_fulfillment", address: core, functionName: "start_fulfillment", args: [intentId], postcondition: async () => { const item = asRecord(await readLatest(client, core, "get_intent", [intentId], latestFinal)); if (item.status !== "FULFILLMENT_PENDING") throw new Error(`Fulfillment did not start: ${item.status}`); return item; }});
  await executeWrite({client, account, state, abi, label: "core:define_evidence:fulfillment", address: core, functionName: "define_evidence", args: [intentId, FULFILLMENT_EVIDENCE.kind, FULFILLMENT_EVIDENCE.url, AUTHORITY, evidence.fulfillment.sha256, BigInt(evidence.fulfillment.byteLength), AUTHORITY, 1n], postcondition: async () => asRecord(await readLatest(client, core, "get_evidence", [intentId, 1n], latestFinal))});
  const stagedFulfillment = await executeWrite({client, account, state, abi, label: "core:stage_evidence:fulfillment", address: core, functionName: "stage_evidence", args: [intentId], postcondition: async () => { const item = asRecord(await readLatest(client, core, "get_intent", [intentId], latestFinal)); const definition = asRecord(await readLatest(client, core, "get_evidence", [intentId, 1n], latestFinal)); if (item.status !== "EVIDENCE_READY" || definition.evidence_kind !== "FULFILLMENT" || definition.sequence !== "1") throw new Error("Sequence-one fulfillment evidence was not staged canonically"); const snapshot = asRecord(await readLatest(client, core, "get_snapshot", [item.current_snapshot_id], latestFinal)); return {intent: item, definition, snapshot}; }});
  state.observations.prematureAssessment = {liveTransactionSent: false, result: "NOT_SENT", proof: "Direct Mode adversarial/state-machine regression plus deployed-source parity; no deliberate reverting Studionet write was sent."};
  saveState(state);
  const assessment = await executeWrite({client, account, state, abi, label: "core:assess_fulfillment", address: core, functionName: "assess_fulfillment", args: [intentId], postcondition: async () => { const item = asRecord(await readLatest(client, core, "get_intent", [intentId], latestFinal)); const instruction = asRecord(await readLatest(client, core, "get_settlement_instruction", [intentId], latestFinal)); if (item.status !== "FULFILLED" || instruction.direction !== "RELEASE_TO_COUNTERPARTY") throw new Error(`Fulfillment result was not canonical FULFILLED/release: ${item.status}/${instruction.direction}`); return {intent: item, settlement: instruction}; }});

  const challengeCountBefore = Number(await readLatest(client, core, "get_challenge_count", [intentId], latestFinal));
  state.observations.challengeCountBefore = challengeCountBefore;
  saveState(state);
  const opened = await executeWrite({client, account, state, abi, label: "core:open_dispute", address: core, functionName: "open_dispute", args: [intentId, "Independent review of the authenticated fulfillment artifact and its committed settlement identity."], precondition: async () => { const item = asRecord(await readLatest(client, core, "get_intent", [intentId], latestFinal)); if (item.status !== "FULFILLED") throw new Error(`Challenge open precondition status=${item.status}`); }, postcondition: async () => { const count = Number(await readLatest(client, core, "get_challenge_count", [intentId], latestFinal)); if (count !== challengeCountBefore + 1) throw new Error("Challenge count did not advance exactly once"); const challengeId = text(await readLatest(client, core, "get_challenge_id", [intentId, BigInt(count - 1)], latestFinal)); const challenge = asRecord(await readLatest(client, core, "get_dispute", [challengeId], latestFinal)); if (challenge.status !== "SUBMITTED") throw new Error(`New challenge is not SUBMITTED: ${challenge.status}`); return {count, challengeId, challenge}; }});
  const challengeId = opened.readback.challengeId;
  const submittedSettlement = asRecord(await readLatest(client, core, "get_settlement_instruction", [intentId], latestFinal));
  if (submittedSettlement.status === "CHALLENGE_BLOCKED" || submittedSettlement.direction === "") throw new Error("SUBMITTED challenge incorrectly blocked settlement");
  state.observations.submittedChallengeSettlement = submittedSettlement;
  saveState(state);

  const challengeEvidenceCountBefore = Number(opened.readback.challenge.evidence_ids ? String(opened.readback.challenge.evidence_ids).split(",").filter(Boolean).length : 0);
  const definedChallenge = await executeWrite({client, account, state, abi, label: "core:define_challenge_evidence", address: core, functionName: "define_challenge_evidence", args: [challengeId, CHALLENGE_EVIDENCE.kind, CHALLENGE_EVIDENCE.url, AUTHORITY, evidence.challenge.sha256, BigInt(evidence.challenge.byteLength), AUTHORITY, BigInt(challengeEvidenceCountBefore)], postcondition: async () => { const challenge = asRecord(await readLatest(client, core, "get_dispute", [challengeId], latestFinal)); const record = asRecord(await readLatest(client, core, "get_challenge_evidence", [challengeId, BigInt(challengeEvidenceCountBefore)], latestFinal)); const count = String(challenge.evidence_ids ?? "").split(",").filter(Boolean).length; if (Number(count) !== challengeEvidenceCountBefore + 1 || record.evidence_kind !== "CHALLENGE") throw new Error("Challenge evidence count/record did not advance exactly once"); return {challenge, record}; }});
  const stagedChallenge = await executeWrite({client, account, state, abi, label: "core:stage_challenge_evidence", address: core, functionName: "stage_challenge_evidence", args: [challengeId], postcondition: async () => { const challenge = asRecord(await readLatest(client, core, "get_dispute", [challengeId], latestFinal)); const intent = asRecord(await readLatest(client, core, "get_intent", [intentId], latestFinal)); const snapshot = challenge.independent_snapshot_id ? asRecord(await readLatest(client, core, "get_snapshot", [challenge.independent_snapshot_id], latestFinal)) : {}; if (!["QUALIFYING", "EVIDENCE_RETRY_REQUIRED", "INADMISSIBLE"].includes(challenge.status)) throw new Error(`Unexpected challenge staging state ${challenge.status}`); if (challenge.status !== "QUALIFYING") throw new Error(`Live V8 challenge did not qualify: ${challenge.status}/${challenge.last_error}`); if (intent.status !== "DISPUTED") throw new Error(`Qualifying challenge did not dispute Intent: ${intent.status}`); return {challenge, intent, snapshot}; }});
  const blockedSettlement = asRecord(await readLatest(client, core, "get_settlement_instruction", [intentId], latestFinal));
  if (blockedSettlement.status !== "CHALLENGE_BLOCKED" || blockedSettlement.direction !== "" || blockedSettlement.oldest_open_challenge !== challengeId) throw new Error(`Challenge settlement block proof failed: ${JSON.stringify(blockedSettlement)}`);
  state.observations.challengeBlockingProof = {submitted: submittedSettlement, qualifying: stagedChallenge.readback, settlement: blockedSettlement};
  saveState(state);

  const adjudication = await executeWrite({client, account, state, abi, label: "core:adjudicate_dispute", address: core, functionName: "adjudicate_dispute", args: [challengeId], postcondition: async () => { const challenge = asRecord(await readLatest(client, core, "get_dispute", [challengeId], latestFinal)); const intent = asRecord(await readLatest(client, core, "get_intent", [intentId], latestFinal)); const settlement = asRecord(await readLatest(client, core, "get_settlement_instruction", [intentId], latestFinal)); if (!["RESOLVED", "ASSESSMENT_RETRY_REQUIRED"].includes(challenge.status)) throw new Error(`Unexpected adjudication state ${challenge.status}`); return {challenge, intent, settlement}; }});
  const adjudicated = adjudication.readback;
  if (adjudicated.challenge.status !== "RESOLVED") throw new Error(`Adjudication requires explicit inspection/retry: ${JSON.stringify(adjudicated.challenge)}`);
  if (!["RELEASE_TO_COUNTERPARTY", "REFUND_TO_PRINCIPAL"].includes(adjudicated.challenge.resolution)) throw new Error("Resolved challenge has no permitted resolution");
  if (adjudicated.settlement.status === "CHALLENGE_BLOCKED" || adjudicated.settlement.oldest_open_challenge !== "") throw new Error("Resolved challenge still blocks settlement");
  state.observations.adjudication = adjudicated;
  saveState(state);

  const finalInstruction = asRecord(await readLatest(client, core, "get_settlement_instruction", [intentId], latestFinal));
  if (finalInstruction.direction !== "RELEASE_TO_COUNTERPARTY") throw new Error(`Live qualification direction changed unexpectedly: ${finalInstruction.direction}`);
  await waitForChainTime(client, Number(finalInstruction.ready_at), "SETTLEMENT_READY");
  const settlement = await executeWrite({client, account, state, abi, label: "vault:request_release", address: vault, functionName: "request_release", args: [intentId], precondition: async () => { const instruction = asRecord(await readLatest(client, core, "get_settlement_instruction", [intentId], latestFinal)); const reservation = asRecord(await readLatest(client, vault, "get_reservation", [intentId], latestFinal)); if (instruction.direction !== "RELEASE_TO_COUNTERPARTY" || instruction.status === "CHALLENGE_BLOCKED" || reservation.status !== "RESERVED") throw new Error("Release precondition is not canonically satisfied"); }, postcondition: async () => { const reservation = asRecord(await readLatest(client, vault, "get_reservation", [intentId], latestFinal)); const accounting = asRecord(await readLatest(client, vault, "get_accounting", [mandateId], latestFinal)); if (reservation.status !== "RELEASE_PENDING" || accounting.reserved !== "0" || accounting.release_pending !== "1" || accounting.conserved !== true) throw new Error("Release/accounting postcondition failed"); return {reservation, accounting}; }});
  let childTransactions: AnyRecord[] = [];
  try {
    const ids = await getTriggeredTransactionIds({client, hash: settlement.hash});
    for (const child of ids) {
      const childTx = await reconcileSameHash({client, hash: child, interval: POLL_MS});
      childTransactions.push({hash: child, status: txStatus(childTx.tx), execution: txExecution(childTx.tx), successful: isSuccessful(childTx.tx)});
    }
  } catch (error: any) {
    childTransactions.push({status: "UNCONFIRMED", error: text(error?.message ?? error)});
  }
  const finalIntent = asRecord(await readLatest(client, core, "get_intent", [intentId], latestFinal));
  const finalReservation = asRecord(await readLatest(client, vault, "get_reservation", [intentId], latestFinal));
  const finalAccounting = asRecord(await readLatest(client, vault, "get_accounting", [mandateId], latestFinal));
  const settlementRecord = finalReservation.settlement_id ? asRecord(await readLatest(client, vault, "get_settlement", [finalReservation.settlement_id], latestFinal)) : {};
  if (finalAccounting.conserved !== true || finalAccounting.reserved !== "0") throw new Error(`Final accounting invariant failed: ${JSON.stringify(finalAccounting)}`);
  state.observations.final = {intent: finalIntent, reservation: finalReservation, accounting: finalAccounting, settlement: settlementRecord, childTransactions, externalObservation: settlementRecord.external_observation ?? "UNCONFIRMED"};
  state.observations.expiry = {liveProof: "NOT_RUN_TIME_BOUND", reason: "CHALLENGE_REVIEW_GRACE_SECONDS is 3600; expiry was not falsified by weakening protocol timing. Direct/state-machine and frontend expiry coverage remain required."};
  saveState(state);

  saveJson(path.join(PROOF_DIR, "deployment.json"), {
    version: "V8",
    network: NETWORK,
    rpc: RPC,
    chainId: CHAIN_ID,
    sourceCommit: SOURCE_COMMIT,
    core: {address: core, deployTx: state.steps["deploy:v8-core"].tx, sha256: CORE_SHA, sourceParity: state.steps["deploy:v8-core"].readback},
    vault: {address: vault, deployTx: state.steps["deploy:v8-vault"].tx, sha256: VAULT_SHA, sourceParity: state.steps["deploy:v8-vault"].readback},
    binding: {vaultBindCoreTx: state.steps["vault:bind_core"].tx, coreSetVaultAddressTx: state.steps["core:set_vault_address"].tx, coreToVault: boundCore, vaultToCore: boundVault},
  });
  saveJson(path.join(PROOF_DIR, "lifecycle.json"), {
    version: "V8",
    signer: EXPECTED_SIGNER.toLowerCase(),
    mandateId,
    intentId,
    authorization: {tx: auth.hash, state: state.steps["core:authorize_intent"].readback},
    reservation: {tx: state.steps["vault:reserve"].tx, state: state.steps["vault:reserve"].readback},
    fulfillment: {startTx: state.steps["core:start_fulfillment"].tx, definitionTx: state.steps["core:define_evidence:fulfillment"].tx, stageTx: state.steps["core:stage_evidence:fulfillment"].tx, assessmentTx: assessment.hash, state: assessment.readback},
    settlement: {tx: settlement.hash, state: settlement.readback, externalObservation: state.observations.final.externalObservation},
  });
  saveJson(path.join(PROOF_DIR, "fulfillment-gate.json"), {
    version: "V8",
    prematureAssessment: state.observations.prematureAssessment,
    sequenceZeroAuthorization: {url: AUTH_URL, sha256: evidence.authorization.sha256, byteLength: evidence.authorization.byteLength, definition: state.steps["core:define_evidence:authorization"].readback},
    sequenceOneFulfillment: {url: AUTH_URL, sha256: evidence.fulfillment.sha256, byteLength: evidence.fulfillment.byteLength, defineTx: state.steps["core:define_evidence:fulfillment"].tx, stageTx: state.steps["core:stage_evidence:fulfillment"].tx, canonicalReadback: stagedFulfillment.readback},
    assessment: {tx: assessment.hash, canonicalReadback: assessment.readback},
    invariant: "assess_fulfillment is contract-gated before objective checks, semantic consensus, and fulfillment/settlement mutation.",
  });
  saveJson(path.join(PROOF_DIR, "challenge-flow.json"), {
    version: "V8",
    intentId,
    challengeId,
    evidence: {url: CHALLENGE_URL, authority: AUTHORITY, sha256: evidence.challenge.sha256, byteLength: evidence.challenge.byteLength, defineTx: definedChallenge.hash, stageTx: stagedChallenge.hash},
    transitions: [
      {state: "SUBMITTED", tx: opened.hash, canonical: opened.readback.challenge},
      {state: "EVIDENCE_PENDING", tx: definedChallenge.hash, canonical: definedChallenge.readback.challenge},
      {state: "QUALIFYING", tx: stagedChallenge.hash, canonical: stagedChallenge.readback.challenge},
      {state: "DISPUTED", canonical: stagedChallenge.readback.intent},
      {state: "CHALLENGE_BLOCKED", canonical: blockedSettlement},
      {state: adjudicated.challenge.status, tx: adjudication.hash, canonical: adjudicated.challenge, settlement: adjudicated.settlement},
    ],
    submittedDoesNotBlock: submittedSettlement.status !== "CHALLENGE_BLOCKED" && submittedSettlement.direction !== "",
    settlementBlockedProof: blockedSettlement.status === "CHALLENGE_BLOCKED" && blockedSettlement.direction === "" && blockedSettlement.oldest_open_challenge === challengeId,
    expiry: state.observations.expiry,
  });
  saveJson(path.join(PROOF_DIR, "source-parity.json"), {version: "V8", sourceCommit: SOURCE_COMMIT, core: state.steps["deploy:v8-core"].readback, vault: state.steps["deploy:v8-vault"].readback, exact: true});
  saveJson(path.join(PROOF_DIR, "final-accounting.json"), {version: "V8", mandateId, intentId, accounting: finalAccounting, conservation: {available: finalAccounting.available, reserved: finalAccounting.reserved, releasePending: finalAccounting.release_pending, refundPending: finalAccounting.refund_pending, recovered: finalAccounting.recovered, deposited: finalAccounting.deposited, conserved: finalAccounting.conserved, reservedAfterSettlementRequest: finalAccounting.reserved === "0"}, settlement: settlementRecord, externalObservation: state.observations.final.externalObservation});
  console.log(JSON.stringify({version: "V8", core, vault, mandateId, intentId, challengeId, settlementTx: settlement.hash, finalAccounting, externalObservation: state.observations.final.externalObservation}, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
