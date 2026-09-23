import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  EXPECTED_SIGNER,
  findExpectedKeystore,
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RPC = "https://studio.genlayer.com/api";
const NETWORK = "studionet";
const CHAIN_ID = 61999;
const EXPECTED_KEYSTORE = "meritround-v2-studionet";
const CORE_SOURCE = path.join(ROOT, "contracts", "pavel_core.py");
const VAULT_SOURCE = path.join(ROOT, "contracts", "pavel_vault.py");
const CORE_SHA = "4acc04c4b684b35058b793973eec75569af9e981eb84d33167198615255b785a";
const VAULT_SHA = "f671005e07a658a17a7711807d23fa56bf0d6e2e85d0a266eafc17b03455f15c";
const AUTH_SCHEMA = "pavel-authorization-v2";
const AUTH_FIELDS = [
  "purpose_aligned", "activity_permitted", "prohibited_activity_absent",
  "counterparty_scope_satisfied", "deliverable_in_scope", "commercial_terms_consistent",
  "evidence_semantically_sufficient", "duplicate_semantic_purchase_absent",
  "authority_scope_preserved", "fulfillment_terms_defined", "external_dependencies_disclosed",
  "constitution_satisfied",
];
const FULFILLMENT_SCHEMA = "pavel-fulfillment-v2";
const FULFILLMENT_FIELDS = ["material_terms_satisfied", "completion_evidence_sufficient"];
const EVIDENCE_URL = "https://docs.genlayer.com/understand-genlayer-protocol/typical-use-cases.md";
const EVIDENCE_AUTHORITY = "docs.genlayer.com";
const EXPECTED_EVIDENCE_SHA = "d00583b58c300822541b7f556c8ac4e97d3b2e5f5e9a0f3af97b753d6f70441d";
const EXPECTED_EVIDENCE_BYTES = 3988;
const AMOUNT = 1n;
const ARTIFACT_DIR = path.join(ROOT, "artifacts", "studionet", "qualification-v7-recovery");
const STATE_PATH = path.join(ARTIFACT_DIR, "checkpoint.json");
const JOURNAL_PATH = path.join(ARTIFACT_DIR, "transactions.json");
const POLL_MS = 5000;
const SEAL_MARGIN_SECONDS = 900;
const MANDATE_HORIZON_SECONDS = 86400;

type AnyRecord = Record<string, any>;
type State = AnyRecord;

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

function saveState(state: State) { saveJson(STATE_PATH, state); }

function appendJournal(entry: AnyRecord) {
  const entries = existsSync(JOURNAL_PATH) ? JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) : [];
  entries.push(jsonSafe({...entry, recordedAt: new Date().toISOString()}));
  saveJson(JOURNAL_PATH, entries);
}

function sha256Bytes(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
function sha256File(filePath: string) { return sha256Bytes(new Uint8Array(readFileSync(filePath))); }
function sameAddress(left: unknown, right: unknown) {
  const a = String(left ?? "").toLowerCase();
  const b = String(right ?? "").toLowerCase();
  return a === b && /^0x[0-9a-f]{40}$/.test(a);
}
function asRecord(value: any): AnyRecord {
  if (typeof value === "string") {
    if (value === "") return {};
    try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function txStatus(tx: AnyRecord) { return String(tx?.statusName ?? tx?.status ?? "UNKNOWN").toUpperCase(); }
function txExecution(tx: AnyRecord) { return String(tx?.txExecutionResultName ?? tx?.execution ?? "UNKNOWN").toUpperCase(); }
function txConsensus(tx: AnyRecord) { return String(tx?.resultName ?? tx?.result_name ?? "UNAVAILABLE").toUpperCase(); }
function txRounds(tx: AnyRecord) {
  const value = tx?.num_of_rounds ?? tx?.numOfRounds ?? tx?.consensus_history?.num_of_rounds ?? tx?.consensusHistory?.numOfRounds;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
function txRotations(tx: AnyRecord) {
  const value = tx?.rotation_count ?? tx?.rotationCount ?? tx?.config_rotation_rounds;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
function deploymentAddress(tx: AnyRecord) {
  for (const value of [tx?.txDataDecoded?.contractAddress, tx?.data?.contract_address, tx?.data?.contractAddress, tx?.contract_address, tx?.contractAddress, tx?.recipient]) {
    if (/^0x[0-9a-f]{40}$/i.test(String(value ?? ""))) return String(value);
  }
  return "";
}
function calldataAddress(CalldataAddress: any, value: string) { return new CalldataAddress(Uint8Array.from(Buffer.from(value.slice(2), "hex"))); }
function emptyState(): State {
  return {
    version: "qualification-v7-recovery",
    network: NETWORK,
    rpc: RPC,
    chainId: CHAIN_ID,
    signer: EXPECTED_SIGNER.toLowerCase(),
    sourceHashes: {core: CORE_SHA, vault: VAULT_SHA},
    steps: {},
    authorization: {attempts: [], submission_count: 0},
    observations: {},
  };
}
function loadState() {
  if (!existsSync(STATE_PATH)) return emptyState();
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  if (state.version !== "qualification-v7-recovery" || state.network !== NETWORK || state.rpc !== RPC || state.chainId !== CHAIN_ID || String(state.signer).toLowerCase() !== EXPECTED_SIGNER.toLowerCase()) throw new Error("V7 checkpoint identity mismatch");
  if (state.sourceHashes?.core !== CORE_SHA || state.sourceHashes?.vault !== VAULT_SHA) throw new Error("V7 checkpoint source identity mismatch");
  return state;
}
function calldataRoundTrip(abi: AnyRecord, functionName: string, args: any[]) {
  const object = abi.calldata.makeCalldataObject(functionName, args, undefined);
  const encoded = abi.calldata.encode(object);
  if (!encoded || encoded.length === 0) throw new Error(`empty calldata for ${functionName}`);
  return abi.calldata.toString(abi.calldata.decode(encoded));
}
async function chainTime(client: AnyRecord) {
  const block = await client.request({method: "eth_getBlockByNumber", params: ["latest", false]});
  const raw = block?.timestamp;
  const value = typeof raw === "string" && raw.startsWith("0x") ? Number.parseInt(raw.slice(2), 16) : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Studionet chain timestamp unavailable");
  return {chainNow: value, blockNumber: block?.number ?? null};
}
async function liveEvidence() {
  const response = await fetch(EVIDENCE_URL, {redirect: "follow"});
  const bytes = new Uint8Array(await response.arrayBuffer());
  const result = {status: response.status, finalUrl: response.url, byteLength: bytes.byteLength, sha256: sha256Bytes(bytes), contentType: response.headers.get("content-type") ?? ""};
  if (result.status !== 200 || result.finalUrl !== EVIDENCE_URL || result.byteLength !== EXPECTED_EVIDENCE_BYTES || result.sha256 !== EXPECTED_EVIDENCE_SHA) throw new Error(`Live evidence identity mismatch: ${JSON.stringify(result)}`);
  saveJson(path.join(ARTIFACT_DIR, "evidence-live-preflight.json"), {url: EVIDENCE_URL, authority: EVIDENCE_AUTHORITY, ...result});
  return result;
}
async function sourceProof(client: AnyRecord, address: string, expectedHash: string) {
  const code = await client.getContractCode(address);
  const actual = sha256Bytes(new TextEncoder().encode(code));
  if (actual !== expectedHash) throw new Error(`Deployed source mismatch at ${address}: expected ${expectedHash}, got ${actual}`);
  return {address, sha256: actual, byteLength: Buffer.byteLength(code, "utf8")};
}
async function read(client: AnyRecord, address: string, functionName: string, args: any[], latestFinal: any) {
  return client.readContract({address, functionName, args, transactionHashVariant: latestFinal});
}
function markSubmitted(state: State, label: string, step: AnyRecord, hash: string) {
  step.tx = hash; step.tx_hash = hash; state.steps[label] = step; saveState(state);
  appendJournal({operation: label, tx: hash, status: "SUBMITTED", args: step.summary ?? []});
  console.log(`TX_SUBMITTED=${label} ${hash}`);
}
async function executeWrite({client, account, state, abi, label, address, functionName, args, value = 0n, summary = [], precondition = async () => {}, postcondition}: AnyRecord) {
  const existing = state.steps[label];
  if (existing?.tx) {
    const reconciled = await reconcileSameHash({client, hash: existing.tx, interval: POLL_MS});
    requireSuccessfulExecution(reconciled.tx);
    const readback = await postcondition();
    state.steps[label] = {...existing, status: "COMPLETE", terminal_status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), execution_success: true, consensus_result: txConsensus(reconciled.tx), canonical_postcondition_met: true, readback: jsonSafe(readback)};
    saveState(state);
    return {hash: existing.tx, tx: reconciled.tx, readback};
  }
  await precondition();
  calldataRoundTrip(abi, functionName, args);
  const step = {label, status: "SUBMITTED", submittedAt: new Date().toISOString(), summary};
  const hash = await sendWriteOnce({client, operation: label, request: {address, functionName, args, value, account}, persistHash: async (txHash) => markSubmitted(state, label, step, txHash)});
  const reconciled = await reconcileSameHash({client, hash, interval: POLL_MS});
  if (!isSuccessful(reconciled.tx)) {
    state.steps[label] = {...step, tx: hash, tx_hash: hash, status: "ERROR", terminal_status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), execution_success: false, consensus_result: txConsensus(reconciled.tx)};
    saveState(state);
    throw new Error(`${label} failed: status=${txStatus(reconciled.tx)} execution=${txExecution(reconciled.tx)} consensus=${txConsensus(reconciled.tx)}`);
  }
  const readback = await postcondition();
  state.steps[label] = {...step, tx: hash, tx_hash: hash, status: "COMPLETE", terminal_status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), execution_success: true, consensus_result: txConsensus(reconciled.tx), canonical_postcondition_met: true, readback: jsonSafe(readback)};
  saveState(state);
  appendJournal({operation: label, tx: hash, status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), consensus: txConsensus(reconciled.tx), readback});
  return {hash, tx: reconciled.tx, readback};
}
async function executeDeploy({client, account, state, label, sourcePath, expectedHash, args}: AnyRecord) {
  if (sha256File(sourcePath) !== expectedHash) throw new Error(`${label} source changed after qualification`);
  const existing = state.steps[label];
  if (existing?.tx) {
    const reconciled = await reconcileSameHash({client, hash: existing.tx, interval: POLL_MS});
    requireSuccessfulExecution(reconciled.tx);
    const address = existing.address || deploymentAddress(reconciled.tx);
    if (!address) throw new Error(`${label} has no authoritative deployed address`);
    const proof = await sourceProof(client, address, expectedHash);
    state.steps[label] = {...existing, status: "COMPLETE", address, readback: proof}; saveState(state);
    return {hash: existing.tx, address, tx: reconciled.tx, readback: proof};
  }
  const step = {label, status: "SUBMITTED", submittedAt: new Date().toISOString(), summary: [{type: "source", sha256: expectedHash}]};
  const code = new Uint8Array(readFileSync(sourcePath));
  const hash = await sendDeployOnce({client, operation: label, request: {code, args, account}, persistHash: async (txHash) => markSubmitted(state, label, step, txHash)});
  const reconciled = await reconcileSameHash({client, hash, interval: POLL_MS});
  if (!isSuccessful(reconciled.tx)) throw new Error(`${label} failed: status=${txStatus(reconciled.tx)} execution=${txExecution(reconciled.tx)}`);
  const address = deploymentAddress(reconciled.tx);
  if (!address) throw new Error(`${label} finalized without an authoritative address`);
  const proof = await sourceProof(client, address, expectedHash);
  state.steps[label] = {...step, tx: hash, tx_hash: hash, status: "COMPLETE", terminal_status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), execution_success: true, consensus_result: txConsensus(reconciled.tx), canonical_postcondition_met: true, address, readback: proof};
  saveState(state); appendJournal({operation: label, tx: hash, status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), consensus: txConsensus(reconciled.tx), address, readback: proof});
  return {hash, address, tx: reconciled.tx, readback: proof};
}
function consensusSummary(tx: AnyRecord) {
  const validators = Array.isArray(tx?.consensus_data?.validators) ? tx.consensus_data.validators : [];
  return validators.map((item: AnyRecord) => ({vote: item.vote ?? "UNAVAILABLE", execution_result: item.execution_result ?? "UNAVAILABLE", nondet_disagree: item.nondet_disagree ?? null, error_code: item.genvm_result?.error_code ?? null, model: item.node_config?.model ?? item.node_config?.primary_model?.model ?? item.node_config?.secondary_model?.model ?? "UNAVAILABLE"}));
}
function authorizationSummary(tx: AnyRecord, intent: AnyRecord, vaultView: AnyRecord, settlement: AnyRecord, reservation: AnyRecord) {
  const authorization = asRecord(intent.authorization); const vector = asRecord(authorization.vector);
  const canonical = authorization.schema === AUTH_SCHEMA && authorization.decision === "AUTHORIZED" && Array.isArray(authorization.failed_checks) && authorization.failed_checks.length === 0 && AUTH_FIELDS.every((field) => typeof vector[field] === "boolean" && vector[field] === true);
  return {status: txStatus(tx), execution: txExecution(tx), consensus: txConsensus(tx), successful_execution: isSuccessful(tx), rounds: txRounds(tx), rotations: txRotations(tx), tx_execution_hash: tx?.execution_hash ?? tx?.tx_execution_hash ?? null, consensus_history: tx?.consensus_history ?? tx?.consensusHistory ?? null, validators: consensusSummary(tx), canonical_commit: canonical, intent_status: intent.status ?? "MISSING", schema: authorization.schema ?? "MISSING", vector, failed_checks: authorization.failed_checks ?? [], vault_view_present: Object.keys(vaultView).length > 0, settlement_status: settlement.status ?? "MISSING", reservation: Object.keys(reservation).length ? reservation : "NONE"};
}
async function authorizeOnce({client, account, state, abi, core, vault, intentId, latestFinal}: AnyRecord) {
  const label = "core:authorize_intent"; const existing = state.steps[label];
  if (existing?.tx) throw new Error("V7 authorization checkpoint already contains a transaction; refusing a second authorization");
  const intent = asRecord(await read(client, core, "get_intent", [intentId], latestFinal));
  if (intent.status !== "EVIDENCE_READY") throw new Error(`Authorization precondition is ${intent.status}`);
  calldataRoundTrip(abi, "authorize_intent", [intentId]);
  const step = {label, status: "SUBMITTED", attempt_number: 1, canonical_postcondition_met: false, summary: [intentId]};
  const hash = await sendWriteOnce({client, operation: label, request: {address: core, functionName: "authorize_intent", args: [intentId], value: 0n, account}, persistHash: async (txHash) => {
    step.tx = txHash; step.tx_hash = txHash; state.steps[label] = step; state.authorization.attempts.push({attempt: 1, tx: txHash, status: "SUBMITTED", canonical_commit: false}); state.authorization.submission_count = 1; saveState(state); appendJournal({operation: label, attempt: 1, tx: txHash, status: "SUBMITTED", args: [intentId]}); console.log(`TX_SUBMITTED=${label} ${txHash}`);
  }});
  const reconciled = await reconcileSameHash({client, hash, interval: POLL_MS});
  const currentIntent = asRecord(await read(client, core, "get_intent", [intentId], latestFinal));
  const authorization = asRecord(currentIntent.authorization);
  let vaultView: AnyRecord = {}; try { vaultView = asRecord(await read(client, core, "get_authorization_for_vault", [intentId], latestFinal)); } catch {}
  const settlement = asRecord(await read(client, core, "get_settlement_instruction", [intentId], latestFinal));
  const reservation = asRecord(await read(client, vault, "get_reservation", [intentId], latestFinal));
  const summary = authorizationSummary(reconciled.tx, currentIntent, vaultView, settlement, reservation);
  state.authorization.attempts[0] = {...state.authorization.attempts[0], status: summary.status, execution: summary.execution, consensus: summary.consensus, rounds: summary.rounds, rotations: summary.rotations, canonical_commit: summary.canonical_commit, execution_success: summary.successful_execution};
  state.steps[label] = {...step, tx: hash, tx_hash: hash, status: summary.canonical_commit ? "COMPLETE" : "RECONCILED_NO_CANONICAL_COMMIT", terminal_status: summary.status, execution: summary.execution, execution_success: summary.successful_execution, consensus_result: summary.consensus, canonical_postcondition_met: summary.canonical_commit, retry_permitted: false, readback: summary};
  state.observations.authorization = summary; saveState(state); appendJournal({operation: label, attempt: 1, tx: hash, ...summary});
  return {hash, tx: reconciled.tx, summary, intent: currentIntent};
}
async function preflight(deps: AnyRecord, state: State) {
  const coreHash = sha256File(CORE_SOURCE); const vaultHash = sha256File(VAULT_SOURCE);
  if (coreHash !== CORE_SHA || vaultHash !== VAULT_SHA) throw new Error(`Qualified source drift: core=${coreHash} vault=${vaultHash}`);
  if (deps.chains.studionet.id !== CHAIN_ID || deps.chains.studionet.rpcUrls.default.http[0] !== RPC) throw new Error("Pinned SDK Studionet definition mismatch");
  const selected = findExpectedKeystore(); if (selected.name !== EXPECTED_KEYSTORE || !sameAddress(selected.address, EXPECTED_SIGNER)) throw new Error("Expected deployment signer profile is not selected");
  const evidence = await liveEvidence();
  const client = deps.createClient({chain: deps.chains.studionet, endpoint: RPC, account: EXPECTED_SIGNER});
  const chainId = await client.getChainId(); if (chainId !== CHAIN_ID) throw new Error(`RPC chain id is ${chainId}, expected ${CHAIN_ID}`);
  const balance = await client.getBalance({address: EXPECTED_SIGNER}); const nonce = await client.getCurrentNonce({address: EXPECTED_SIGNER});
  const rawTxs = await client.request({method: "sim_getTransactionsForAddress", params: [EXPECTED_SIGNER]}); const txs = Array.isArray(rawTxs) ? rawTxs : [];
  const terminal = new Set(["FINALIZED", "ACCEPTED", "REJECTED", "UNDETERMINED", "FAILED", "CANCELLED"]);
  const pending = txs.filter((item: AnyRecord) => !terminal.has(String(item?.statusName ?? item?.status ?? "UNKNOWN").toUpperCase())).map((item: AnyRecord) => ({hash: item.hash, status: item.statusName ?? item.status}));
  if (pending.length) throw new Error(`Unknown pending transactions exist: ${JSON.stringify(pending)}`);
  if (BigInt(balance) < AMOUNT) throw new Error("Deployment signer has insufficient GEN for V7 qualification");
  state.observations.preflight = {network: NETWORK, rpc: RPC, chain_id: chainId, signer: EXPECTED_SIGNER.toLowerCase(), keystore: selected.name, balance: String(balance), latest_nonce: String(nonce), pending_nonce: String(nonce), pending_transactions: pending, core_sha256: coreHash, vault_sha256: vaultHash, evidence}; saveState(state);
  return {client, evidence, selected};
}
async function run() {
  const deps = await loadPinnedDependencies(); const state = loadState();
  const {abi, chains, createAccount, createClient, CalldataAddress} = deps;
  const latestFinal = deps.TransactionHashVariant?.LATEST_FINAL ?? FALLBACK_LATEST_FINAL;
  const {client: readClient, evidence, selected} = await preflight(deps, state);
  console.log(JSON.stringify({NETWORK, CHAIN_ID, CORE_SHA, VAULT_SHA, EVIDENCE_URL, EVIDENCE_SHA: evidence.sha256, EVIDENCE_BYTES: evidence.byteLength, SIGNER: EXPECTED_SIGNER.toLowerCase(), BALANCE: state.observations.preflight.balance, NONCE: state.observations.preflight.latest_nonce}, null, 2));
  if (process.argv.includes("--preflight-only")) return;
  console.log("PREFLIGHT=PASS");
  const loaded = await loadKeychainAccount(deps.Wallet, EXPECTED_KEYSTORE, EXPECTED_SIGNER);
  const account = createAccount(loaded.wallet["private" + "Key"]);
  if (!sameAddress(account.address, EXPECTED_SIGNER)) throw new Error("Decrypted signer address mismatch");
  const client = createClient({chain: chains.studionet, endpoint: RPC, account});
  const coreDeploy = await executeDeploy({client, account, state, label: "deploy:v7-core", sourcePath: CORE_SOURCE, expectedHash: CORE_SHA, args: []});
  const core = coreDeploy.address; state.core = core; saveState(state);
  const vaultDeploy = await executeDeploy({client, account, state, label: "deploy:v7-vault", sourcePath: VAULT_SOURCE, expectedHash: VAULT_SHA, args: [calldataAddress(CalldataAddress, core)]});
  const vault = vaultDeploy.address; state.vault = vault; saveState(state);
  if (!sameAddress(await read(client, vault, "get_core_address", [], latestFinal), core)) throw new Error("Vault constructor binding mismatch");
  await executeWrite({client, account, state, abi, label: "vault:bind_core", address: vault, functionName: "bind_core", args: [], postcondition: async () => ({core: await read(client, vault, "get_core_address", [], latestFinal)})});
  await executeWrite({client, account, state, abi, label: "core:set_vault_address", address: core, functionName: "set_vault_address", args: [calldataAddress(CalldataAddress, vault)], postcondition: async () => ({vault: await read(client, core, "get_vault_address", [], latestFinal)})});
  const boundCore = await read(client, core, "get_vault_address", [], latestFinal); const boundVault = await read(client, vault, "get_core_address", [], latestFinal);
  if (!sameAddress(boundCore, vault) || !sameAddress(boundVault, core)) throw new Error("Bidirectional binding mismatch");
  state.observations.binding = {core, vault, core_to_vault: boundCore, vault_to_core: boundVault, verified: true}; saveState(state);
  await executeWrite({client, account, state, abi, label: "core:register_principal", address: core, functionName: "register_principal", args: [], postcondition: async () => ({principal: EXPECTED_SIGNER.toLowerCase()})});
  await executeWrite({client, account, state, abi, label: "core:register_agent", address: core, functionName: "register_agent", args: [calldataAddress(CalldataAddress, EXPECTED_SIGNER), "PAVEL V7 qualification agent"], postcondition: async () => ({agent: EXPECTED_SIGNER.toLowerCase()})});
  const counterpartyId = "C-1";
  await executeWrite({client, account, state, abi, label: "core:register_counterparty", address: core, functionName: "register_counterparty", args: [calldataAddress(CalldataAddress, EXPECTED_SIGNER), "GenLayer documentation", EVIDENCE_URL], postcondition: async () => asRecord(await read(client, core, "get_counterparty", [counterpartyId], latestFinal))});
  const nowBeforeMandate = await chainTime(client); const validFrom = nowBeforeMandate.chainNow + SEAL_MARGIN_SECONDS; const expiresAt = validFrom + MANDATE_HORIZON_SECONDS; const mandateId = "M-1";
  await executeWrite({client, account, state, abi, label: "core:create_mandate", address: core, functionName: "create_mandate", args: [calldataAddress(CalldataAddress, EXPECTED_SIGNER), ""], postcondition: async () => asRecord(await read(client, core, "get_mandate", [mandateId], latestFinal))});
  const mandateArgs = [mandateId, "PAVEL V7 exact artifact delivery qualification", "Authorize retrieval, authentication, and delivery of the exact registered official GenLayer artifact.", "The principal retains control; only the registered agent may submit the bounded intent.", "Retrieve, authenticate, and deliver the exact official GenLayer Typical Use Cases artifact identified by its URL, SHA-256, and byte length.", "No unrelated activity, recipient change, budget expansion, substitution, or external transfer beyond exact artifact delivery.", AMOUNT, AMOUNT, 86400n, AMOUNT, BigInt(validFrom), BigInt(expiresAt), 60n, "Authenticated HTTPS evidence with the committed URL, SHA-256, and byte length is required.", EVIDENCE_AUTHORITY, "Fulfillment requires delivery of the exact committed artifact with complete authenticated content.", "Use only the approved docs.genlayer.com authority; unresolved fulfillment expires to refund.", false];
  await executeWrite({client, account, state, abi, label: "core:configure_mandate", address: core, functionName: "configure_mandate", args: mandateArgs, postcondition: async () => asRecord(await read(client, core, "get_mandate", [mandateId], latestFinal))});
  await executeWrite({client, account, state, abi, label: "core:seal_mandate", address: core, functionName: "seal_mandate", args: [mandateId], precondition: async () => {
    const currentTime = await chainTime(client);
    const currentMandate = asRecord(await read(client, core, "get_mandate", [mandateId], latestFinal));
    const remaining = Number(currentMandate.valid_from ?? 0) - currentTime.chainNow;
    if (currentMandate.status !== "DRAFT" || remaining < 120) throw new Error(`Seal precondition unsafe: status=${currentMandate.status} remaining=${remaining}`);
  }, postcondition: async () => asRecord(await read(client, core, "get_mandate", [mandateId], latestFinal))});
  let mandate = asRecord(await read(client, core, "get_mandate", [mandateId], latestFinal)); if (mandate.status !== "SEALED") throw new Error("Mandate did not seal");
  await executeWrite({client, account, state, abi, label: "vault:deposit", address: vault, functionName: "deposit", args: [mandateId], value: AMOUNT, postcondition: async () => asRecord(await read(client, vault, "get_accounting", [mandateId], latestFinal))});
  while ((await chainTime(client)).chainNow < Number(mandate.valid_from)) { const remaining = Number(mandate.valid_from) - (await chainTime(client)).chainNow; console.log(`WAITING_FOR_MANDATE_ACTIVATION_SECONDS=${remaining}`); await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_MS, Math.max(1000, remaining * 1000)))); }
  const intentId = "I-1"; const intentExpiry = Math.min(Number(mandate.expires_at), (await chainTime(client)).chainNow + 7200);
  const artifactIdentity = `exact artifact URL=${EVIDENCE_URL}; sha256=${evidence.sha256}; byte_length=${evidence.byteLength}`;
  await executeWrite({client, account, state, abi, label: "core:create_intent", address: core, functionName: "create_intent", args: [mandateId, counterpartyId, calldataAddress(CalldataAddress, EXPECTED_SIGNER), AMOUNT, "Exact GenLayer artifact delivery", `Retrieve and deliver ${artifactIdentity}.`, `The deliverable is the complete authenticated artifact ${artifactIdentity}.`, "Exactly 1 GEN qualification amount; no commercial expansion or substitution.", "Completion requires the complete committed artifact and exact identity to be authenticated.", BigInt(intentExpiry)], postcondition: async () => asRecord(await read(client, core, "get_intent", [intentId], latestFinal))});
  await executeWrite({client, account, state, abi, label: "core:submit_intent", address: core, functionName: "submit_intent", args: [intentId], postcondition: async () => asRecord(await read(client, core, "get_intent", [intentId], latestFinal))});
  await executeWrite({client, account, state, abi, label: "core:define_evidence:authorization", address: core, functionName: "define_evidence", args: [intentId, "PRODUCT_SERVICE", EVIDENCE_URL, EVIDENCE_AUTHORITY, evidence.sha256, BigInt(evidence.byteLength), EVIDENCE_AUTHORITY, 0n], postcondition: async () => asRecord(await read(client, core, "get_evidence", [intentId, 0n], latestFinal))});
  await executeWrite({client, account, state, abi, label: "core:stage_evidence:authorization", address: core, functionName: "stage_evidence", args: [intentId], postcondition: async () => asRecord(await read(client, core, "get_intent", [intentId], latestFinal))});
  const auth = await authorizeOnce({client, account, state, abi, core, vault, intentId, latestFinal});
  if (!auth.summary.canonical_commit) { throw new Error(`V7 authorization did not canonically commit: ${JSON.stringify(auth.summary)}`); }
  await executeWrite({client, account, state, abi, label: "vault:reserve", address: vault, functionName: "reserve", args: [intentId], precondition: async () => { const item = asRecord(await read(client, core, "get_intent", [intentId], latestFinal)); const reservation = asRecord(await read(client, vault, "get_reservation", [intentId], latestFinal)); const accounting = asRecord(await read(client, vault, "get_accounting", [mandateId], latestFinal)); if (item.status !== "AUTHORIZED" || Object.keys(reservation).length || accounting.available !== "1") throw new Error("Reservation precondition failed"); }, postcondition: async () => { const reservation = asRecord(await read(client, vault, "get_reservation", [intentId], latestFinal)); const accounting = asRecord(await read(client, vault, "get_accounting", [mandateId], latestFinal)); if (reservation.status !== "RESERVED" || reservation.intent_id !== intentId || accounting.available !== "0" || accounting.reserved !== "1" || accounting.committed !== "1") throw new Error("Reservation postcondition failed"); return {reservation, accounting}; }});
  await executeWrite({client, account, state, abi, label: "core:start_fulfillment", address: core, functionName: "start_fulfillment", args: [intentId], precondition: async () => { const item = asRecord(await read(client, core, "get_intent", [intentId], latestFinal)); if (item.status !== "AUTHORIZED") throw new Error("Fulfillment start precondition failed"); }, postcondition: async () => { const item = asRecord(await read(client, core, "get_intent", [intentId], latestFinal)); if (item.status !== "FULFILLMENT_PENDING") throw new Error("Fulfillment did not start"); return item; }});
  await executeWrite({client, account, state, abi, label: "core:define_evidence:fulfillment", address: core, functionName: "define_evidence", args: [intentId, "FULFILLMENT", EVIDENCE_URL, EVIDENCE_AUTHORITY, evidence.sha256, BigInt(evidence.byteLength), EVIDENCE_AUTHORITY, 1n], postcondition: async () => asRecord(await read(client, core, "get_evidence", [intentId, 1n], latestFinal))});
  await executeWrite({client, account, state, abi, label: "core:stage_evidence:fulfillment", address: core, functionName: "stage_evidence", args: [intentId], postcondition: async () => asRecord(await read(client, core, "get_intent", [intentId], latestFinal))});
  const assess = await executeWrite({client, account, state, abi, label: "core:assess_fulfillment", address: core, functionName: "assess_fulfillment", args: [intentId], precondition: async () => { const item = asRecord(await read(client, core, "get_intent", [intentId], latestFinal)); if (item.status !== "FULFILLMENT_PENDING") throw new Error("Fulfillment assessment precondition failed"); }, postcondition: async () => { const item = asRecord(await read(client, core, "get_intent", [intentId], latestFinal)); if (!["FULFILLED", "NOT_FULFILLED", "FULFILLMENT_RETRY_REQUIRED"].includes(item.status)) throw new Error(`Unexpected fulfillment state ${item.status}`); return item; }});
  let intent = asRecord(await read(client, core, "get_intent", [intentId], latestFinal)); const fulfillment = asRecord(intent.fulfillment); const settlementInstruction = asRecord(await read(client, core, "get_settlement_instruction", [intentId], latestFinal));
  const baseReport: AnyRecord = {network: NETWORK, chain_id: CHAIN_ID, core, vault, mandate_id: mandateId, mandate_status: mandate.status, intent_id: intentId, auth_evidence_id: asRecord(await read(client, core, "get_evidence", [intentId, 0n], latestFinal)).evidence_id, fulfillment_evidence_id: asRecord(await read(client, core, "get_evidence", [intentId, 1n], latestFinal)).evidence_id, evidence_url: EVIDENCE_URL, evidence_sha256: evidence.sha256, evidence_byte_length: evidence.byteLength, full_content_used: true, truncation_occurred: false, authorization: auth.summary, assessment: {hash: assess.hash, status: txStatus(assess.tx), execution: txExecution(assess.tx), consensus: txConsensus(assess.tx), rounds: txRounds(assess.tx), rotations: txRotations(assess.tx), consensus_history: assess.tx?.consensus_history ?? assess.tx?.consensusHistory ?? null}, fulfillment_status: intent.status, fulfillment, settlement_instruction: settlementInstruction};
  if (intent.status !== "FULFILLED") { state.observations.final = {...baseReport, terminal: "NOT_FULFILLED_OR_INCONCLUSIVE"}; saveState(state); saveJson(path.join(ARTIFACT_DIR, "final-report.json"), state.observations.final); console.log(JSON.stringify(state.observations.final, null, 2)); throw new Error(`V7 fulfillment did not complete: ${intent.status}`); }
  const readyAt = Number(settlementInstruction.ready_at ?? "0"); while ((await chainTime(client)).chainNow < readyAt) { const remaining = readyAt - (await chainTime(client)).chainNow; console.log(`WAITING_FOR_SETTLEMENT_WINDOW_SECONDS=${remaining}`); await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_MS, Math.max(1000, remaining * 1000)))); }
  const settlement = await executeWrite({client, account, state, abi, label: "vault:request_release", address: vault, functionName: "request_release", args: [intentId], precondition: async () => { const instruction = asRecord(await read(client, core, "get_settlement_instruction", [intentId], latestFinal)); const reservation = asRecord(await read(client, vault, "get_reservation", [intentId], latestFinal)); if (instruction.direction !== "RELEASE_TO_COUNTERPARTY" || Object.keys(reservation).length === 0 || reservation.status !== "RESERVED") throw new Error("Release precondition failed"); }, postcondition: async () => { const reservation = asRecord(await read(client, vault, "get_reservation", [intentId], latestFinal)); const accounting = asRecord(await read(client, vault, "get_accounting", [mandateId], latestFinal)); if (reservation.status !== "RELEASE_PENDING" || accounting.reserved !== "0" || accounting.release_pending !== "1") throw new Error("Release postcondition failed"); return {reservation, accounting}; }});
  let children: AnyRecord[] = []; try { const ids = await getTriggeredTransactionIds({client, hash: settlement.hash}); for (const child of ids) { const reconciled = await reconcileSameHash({client, hash: child, interval: POLL_MS}); children.push({hash: child, status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), successful: isSuccessful(reconciled.tx)}); } } catch (error: any) { children.push({status: "UNCONFIRMED", error: String(error?.message ?? error)}); }
  intent = asRecord(await read(client, core, "get_intent", [intentId], latestFinal)); const reservation = asRecord(await read(client, vault, "get_reservation", [intentId], latestFinal)); const accounting = asRecord(await read(client, vault, "get_accounting", [mandateId], latestFinal)); const settlementRecord = reservation.settlement_id ? asRecord(await read(client, vault, "get_settlement", [reservation.settlement_id], latestFinal)) : {};
  const finalReport = {...baseReport, final_intent_status: intent.status, settlement_tx: settlement.hash, settlement_status: txStatus(settlement.tx), settlement_execution: txExecution(settlement.tx), settlement_consensus: txConsensus(settlement.tx), settlement_canonical_commit: reservation.status === "RELEASE_PENDING", reservation, accounting, settlement_record: settlementRecord, child_transactions: children, final_lifecycle_state: "FULFILLED_RELEASE_PENDING_EXTERNAL_UNCONFIRMED", live_timeout_recovery_tested: false, live_timeout_recovery_reason: "avoided additional funded failure flow"};
  state.observations.final = finalReport; saveState(state); saveJson(path.join(ARTIFACT_DIR, "final-report.json"), finalReport); console.log(JSON.stringify(finalReport, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
