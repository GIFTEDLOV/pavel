import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {
  EXPECTED_SIGNER,
  findExpectedKeystore,
  loadExistingAccount,
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
import {AUTHORIZATION_V6_FIELDS, AUTHORIZATION_V6_SCHEMA} from "./lib/authorization-v6.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RPC = "https://studio.genlayer.com/api";
const NETWORK = "studionet";
const CHAIN_ID = 61999;
const EXPECTED_KEYSTORE = "meritround-v2-studionet";
const CORE_SOURCE = path.join(ROOT, "contracts", "pavel_core.py");
const VAULT_SOURCE = path.join(ROOT, "contracts", "pavel_vault.py");
const CORE_SHA = "4212e38df316a95f6525d92cf92743e37b3e92b312f70b98bfdc2b0a4ae20ca0";
const VAULT_SHA = "d967d6f1e70cd698fc428338ca822c5541ce07fd7977517db7bb19f9796aa8ed";
const EVIDENCE_URL = "https://docs.genlayer.com/understand-genlayer-protocol/typical-use-cases.md";
const EVIDENCE_AUTHORITY = "docs.genlayer.com";
const EVIDENCE_SHA = "d00583b58c300822541b7f556c8ac4e97d3b2e5f5e9a0f3af97b753d6f70441d";
const EVIDENCE_BYTES = 3988;
const AMOUNT = 1n;
const ARTIFACT_DIR = path.join(ROOT, "artifacts", "studionet", "qualification-v6-live");
const STATE_PATH = path.join(ARTIFACT_DIR, "checkpoint.json");
const JOURNAL_PATH = path.join(ARTIFACT_DIR, "transactions.json");
const POLL_MS = 5000;
const SEAL_MARGIN_SECONDS = 600;
const MANDATE_HORIZON_SECONDS = 172800;

type AnyRecord = Record<string, any>;
type Step = AnyRecord;
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

function saveState(state: State) {
  saveJson(STATE_PATH, state);
}

function appendJournal(entry: AnyRecord) {
  let entries: AnyRecord[] = [];
  if (existsSync(JOURNAL_PATH)) entries = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
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
  return String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase() && /^0x[0-9a-f]{40}$/i.test(String(left ?? ""));
}

function calldataAddress(CalldataAddress: any, value: string) {
  return new CalldataAddress(Uint8Array.from(Buffer.from(value.slice(2), "hex")));
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

function txStatus(tx: AnyRecord) {
  return String(tx?.statusName ?? tx?.status ?? "UNKNOWN").toUpperCase();
}

function txExecution(tx: AnyRecord) {
  return String(tx?.txExecutionResultName ?? tx?.execution ?? "UNKNOWN").toUpperCase();
}

function txConsensus(tx: AnyRecord) {
  return String(tx?.resultName ?? tx?.result_name ?? "UNAVAILABLE").toUpperCase();
}

function txRounds(tx: AnyRecord) {
  const value = tx?.num_of_rounds ?? tx?.numOfRounds ?? tx?.consensus_history?.num_of_rounds ?? tx?.consensusHistory?.numOfRounds;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function txRotations(tx: AnyRecord) {
  const value = tx?.rotation_count ?? tx?.rotationCount ?? tx?.config_rotation_rounds;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function deploymentAddress(tx: AnyRecord) {
  const values = [tx?.txDataDecoded?.contractAddress, tx?.data?.contract_address, tx?.data?.contractAddress, tx?.contract_address, tx?.contractAddress, tx?.recipient];
  for (const value of values) {
    if (/^0x[0-9a-f]{40}$/i.test(String(value ?? ""))) return String(value);
  }
  return "";
}

function emptyState(): State {
  return {
    version: "qualification-v6-live",
    network: NETWORK,
    rpc: RPC,
    chainId: CHAIN_ID,
    signer: EXPECTED_SIGNER.toLowerCase(),
    sourceHashes: {core: CORE_SHA, vault: VAULT_SHA},
    steps: {},
    authorization: {attempts: [], submission_count: 0},
    observations: {reservation_attempted: false},
  };
}

function loadState() {
  if (!existsSync(STATE_PATH)) return emptyState();
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  if (state.version !== "qualification-v6-live" || state.network !== NETWORK || state.rpc !== RPC || state.chainId !== CHAIN_ID || String(state.signer).toLowerCase() !== EXPECTED_SIGNER.toLowerCase()) throw new Error("V6 live checkpoint identity mismatch");
  if (state.sourceHashes?.core !== CORE_SHA || state.sourceHashes?.vault !== VAULT_SHA) throw new Error("V6 live checkpoint source identity mismatch");
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
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Studionet latest chain timestamp unavailable");
  return {chainNow: value, blockNumber: block?.number ?? null};
}

async function liveEvidence() {
  const response = await fetch(EVIDENCE_URL, {redirect: "follow"});
  const bytes = new Uint8Array(await response.arrayBuffer());
  const result = {status: response.status, finalUrl: response.url, byteLength: bytes.byteLength, sha256: sha256Bytes(bytes), contentType: response.headers.get("content-type") ?? ""};
  if (result.status !== 200 || result.finalUrl !== EVIDENCE_URL || result.byteLength !== EVIDENCE_BYTES || result.sha256 !== EVIDENCE_SHA) throw new Error(`Live evidence identity mismatch: ${JSON.stringify(result)}`);
  saveJson(path.join(ARTIFACT_DIR, "evidence-live-preflight.json"), {url: EVIDENCE_URL, authority: EVIDENCE_AUTHORITY, ...result});
  return result;
}

async function loadUnlockedAccount(Wallet: any, prompt: any, selected: AnyRecord) {
  let cachedKey = "";
  try {
    const pnpmRoot = path.join(ROOT, "node_modules", ".pnpm");
    const keytarEntry = readdirSync(pnpmRoot).find((name) => name.startsWith("keytar@7.9.0"));
    if (keytarEntry) {
      const keytarModule = await import(pathToFileURL(path.join(pnpmRoot, keytarEntry, "node_modules", "keytar", "lib", "keytar.js")).href);
      const keytar = keytarModule.default ?? keytarModule;
      cachedKey = String(await keytar.getPassword("genlayer-cli", `account:${selected.name}`) ?? "");
    }
  } catch {
    cachedKey = "";
  }
  if (/^0x[0-9a-f]{64}$/i.test(cachedKey)) {
    const wallet = new Wallet(cachedKey);
    cachedKey = "";
    if (!sameAddress(wallet.address, EXPECTED_SIGNER)) throw new Error("Cached unlocked signer does not match the expected deployment account");
    return {wallet, accountName: selected.name, selectedKeystoreAddress: String(selected.address).toLowerCase()};
  }
  cachedKey = "";
  return loadExistingAccount(Wallet, prompt, selected);
}

async function sourceProof(client: AnyRecord, address: string, expectedHash: string) {
  const code = await client.getContractCode(address);
  const actual = sha256Bytes(new TextEncoder().encode(code));
  if (actual !== expectedHash) throw new Error(`Deployed source mismatch at ${address}: expected ${expectedHash}, got ${actual}`);
  return {address, sha256: actual, byteLength: Buffer.byteLength(code, "utf8")};
}

async function read(client: AnyRecord, address: string, functionName: string, args: any[] = [], latestFinal: any) {
  return client.readContract({address, functionName, args, transactionHashVariant: latestFinal});
}

function markSubmitted(state: State, step: Step, hash: string) {
  step.tx = hash;
  step.tx_hash = hash;
  state.steps[step.label] = step;
  saveState(state);
  appendJournal({operation: step.label, tx: hash, status: "SUBMITTED", args: step.summary ?? []});
  console.log(`TX_SUBMITTED=${step.label} ${hash}`);
}

async function executeWrite({client, account, state, abi, label, address, functionName, args, value = 0n, summary = [], precondition = async () => {}, postcondition}: AnyRecord) {
  const existing = state.steps[label];
  if (existing?.tx) {
    const reconciled = await reconcileSameHash({client, hash: existing.tx, interval: POLL_MS});
    requireSuccessfulExecution(reconciled.tx);
    const readback = await postcondition();
    state.steps[label] = {...existing, status: "COMPLETE", terminal_status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), execution_success: true, consensus_result: txConsensus(reconciled.tx), readback: jsonSafe(readback)};
    saveState(state);
    return {hash: existing.tx, tx: reconciled.tx, readback};
  }
  await precondition();
  calldataRoundTrip(abi, functionName, args);
  const step = {label, status: "SUBMITTED", submittedAt: new Date().toISOString(), summary};
  const hash = await sendWriteOnce({
    client,
    operation: label,
    request: {address, functionName, args, value, account},
    persistHash: async (txHash) => markSubmitted(state, step, txHash),
  });
  const reconciled = await reconcileSameHash({client, hash, interval: POLL_MS});
  if (!isSuccessful(reconciled.tx)) {
    state.steps[label] = {...step, tx: hash, tx_hash: hash, status: "ERROR", terminal_status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), execution_success: false, consensus_result: txConsensus(reconciled.tx)};
    saveState(state);
    throw new Error(`${label} did not execute successfully: status=${txStatus(reconciled.tx)} execution=${txExecution(reconciled.tx)} consensus=${txConsensus(reconciled.tx)}`);
  }
  const readback = await postcondition();
  state.steps[label] = {...step, tx: hash, tx_hash: hash, status: "COMPLETE", terminal_status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), execution_success: true, consensus_result: txConsensus(reconciled.tx), readback: jsonSafe(readback)};
  saveState(state);
  appendJournal({operation: label, tx: hash, status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), consensus: txConsensus(reconciled.tx), readback});
  return {hash, tx: reconciled.tx, readback};
}

async function executeDeploy({client, account, state, label, sourcePath, expectedHash, args, summary}: AnyRecord) {
  const actualHash = sha256File(sourcePath);
  if (actualHash !== expectedHash) throw new Error(`${label} source changed after qualification`);
  const existing = state.steps[label];
  if (existing?.tx) {
    const reconciled = await reconcileSameHash({client, hash: existing.tx, interval: POLL_MS});
    requireSuccessfulExecution(reconciled.tx);
    const address = existing.address || deploymentAddress(reconciled.tx);
    if (!address) throw new Error(`${label} has no authoritative deployed address`);
    const parity = await sourceProof(client, address, expectedHash);
    state.steps[label] = {...existing, status: "COMPLETE", address, readback: parity};
    saveState(state);
    return {hash: existing.tx, address, tx: reconciled.tx, readback: parity};
  }
  const step = {label, status: "SUBMITTED", submittedAt: new Date().toISOString(), summary};
  const code = new Uint8Array(readFileSync(sourcePath));
  const hash = await sendDeployOnce({
    client,
    operation: label,
    request: {code, args, account},
    persistHash: async (txHash) => markSubmitted(state, step, txHash),
  });
  const reconciled = await reconcileSameHash({client, hash, interval: POLL_MS});
  if (!isSuccessful(reconciled.tx)) {
    state.steps[label] = {...step, tx: hash, tx_hash: hash, status: "ERROR", terminal_status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), consensus_result: txConsensus(reconciled.tx)};
    saveState(state);
    throw new Error(`${label} did not execute successfully: status=${txStatus(reconciled.tx)} execution=${txExecution(reconciled.tx)}`);
  }
  const address = deploymentAddress(reconciled.tx);
  if (!address) throw new Error(`${label} finalized without an authoritative address`);
  const parity = await sourceProof(client, address, expectedHash);
  state.steps[label] = {...step, tx: hash, tx_hash: hash, status: "COMPLETE", terminal_status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), execution_success: true, consensus_result: txConsensus(reconciled.tx), address, readback: parity};
  saveState(state);
  appendJournal({operation: label, tx: hash, status: txStatus(reconciled.tx), execution: txExecution(reconciled.tx), consensus: txConsensus(reconciled.tx), address, readback: parity});
  return {hash, address, tx: reconciled.tx, readback: parity};
}

function authVector(record: AnyRecord) {
  const vector = asRecord(record.vector);
  const result: AnyRecord = {};
  for (const field of AUTHORIZATION_V6_FIELDS) result[field] = vector[field];
  return result;
}

function authCommit(item: AnyRecord) {
  const auth = asRecord(item.authorization);
  const vector = asRecord(auth.vector);
  const keys = Object.keys(vector);
  return auth.schema === AUTHORIZATION_V6_SCHEMA && keys.length === AUTHORIZATION_V6_FIELDS.length && AUTHORIZATION_V6_FIELDS.every((field) => typeof vector[field] === "boolean") && Array.isArray(auth.failed_checks);
}

function consensusSummary(tx: AnyRecord) {
  const validators = Array.isArray(tx?.consensus_data?.validators) ? tx.consensus_data.validators : [];
  return validators.map((item: AnyRecord) => ({
    vote: item.vote ?? "UNAVAILABLE",
    execution_result: item.execution_result ?? "UNAVAILABLE",
    nondet_disagree: item.nondet_disagree ?? null,
    error_code: item.genvm_result?.error_code ?? null,
    model: item.node_config?.model ?? item.node_config?.primary_model?.model ?? item.node_config?.secondary_model?.model ?? "UNAVAILABLE",
  }));
}

async function executeAuthorization({client, account, state, abi, core, intentId, latestFinal}: AnyRecord) {
  const label = "core:authorize_intent";
  const existing = state.steps[label];
  let hash = existing?.tx;
  let reconciled: AnyRecord;
  if (!hash) {
    const intent = asRecord(await read(client, core, "get_intent", [intentId], latestFinal));
    if (intent.status !== "EVIDENCE_READY") throw new Error(`Authorization precondition is ${intent.status}, not EVIDENCE_READY`);
    calldataRoundTrip(abi, "authorize_intent", [intentId]);
    const step = {label, status: "SUBMITTED", attempt_number: 1, submittedAt: new Date().toISOString(), canonical_postcondition_met: false, retry_permitted: false, summary: [{intentId}]};
    hash = await sendWriteOnce({
      client,
      operation: label,
      request: {address: core, functionName: "authorize_intent", args: [intentId], value: 0n, account},
      persistHash: async (txHash) => {
        step.tx = txHash;
        step.tx_hash = txHash;
        state.steps[label] = step;
        state.authorization.attempts.push({attempt: 1, tx: txHash, status: "SUBMITTED", execution: "PENDING", consensus: "UNAVAILABLE", canonical_commit: false});
        state.authorization.submission_count = 1;
        saveState(state);
        appendJournal({operation: label, attempt: 1, tx: txHash, status: "SUBMITTED", args: [intentId]});
        console.log(`TX_SUBMITTED=${label} ${txHash}`);
      },
    });
  } else if (state.authorization?.submission_count !== 1) {
    throw new Error("Authorization checkpoint does not prove exactly one V6 submission");
  }
  reconciled = await reconcileSameHash({client, hash, interval: POLL_MS});
  const tx = reconciled.tx;
  const intent = asRecord(await read(client, core, "get_intent", [intentId], latestFinal));
  const authorization = asRecord(intent.authorization);
  let vaultView: AnyRecord = {};
  try { vaultView = asRecord(await read(client, core, "get_authorization_for_vault", [intentId], latestFinal)); } catch { vaultView = {}; }
  const settlement = asRecord(await read(client, core, "get_settlement_instruction", [intentId], latestFinal));
  const reservation = asRecord(await read(client, state.vault, "get_reservation", [intentId], latestFinal));
  const canonicalCommit = authCommit(intent);
  const summary = {
    hash,
    status: txStatus(tx),
    execution: txExecution(tx),
    consensus: txConsensus(tx),
    successful_execution: isSuccessful(tx),
    num_rounds: txRounds(tx),
    rotation_count: txRotations(tx),
    tx_execution_hash: tx?.execution_hash ?? tx?.tx_execution_hash ?? null,
    consensus_history: tx?.consensus_history ?? tx?.consensusHistory ?? null,
    validators: consensusSummary(tx),
    canonical_commit: canonicalCommit,
    intent_status: intent.status ?? "MISSING",
    authorization_schema: authorization.schema ?? "MISSING",
    authorization_vector: authVector(authorization),
    failed_checks: authorization.failed_checks ?? [],
    vault_view_present: Object.keys(vaultView).length > 0,
    settlement_status: settlement.status ?? "MISSING",
    reservation: Object.keys(reservation).length > 0 ? reservation : "NONE",
  };
  state.authorization.attempts[0] = {...state.authorization.attempts[0], status: summary.status, execution: summary.execution, consensus: summary.consensus, canonical_commit: canonicalCommit, execution_success: summary.successful_execution, terminal_status: summary.status, num_rounds: summary.num_rounds, rotation_count: summary.rotation_count};
  state.steps[label] = {...(state.steps[label] ?? {label, tx: hash, attempt_number: 1}), tx: hash, tx_hash: hash, status: canonicalCommit ? "COMPLETE" : "RECONCILED_NO_CANONICAL_COMMIT", terminal_status: summary.status, execution: summary.execution, execution_success: summary.successful_execution, consensus_result: summary.consensus, canonical_postcondition_met: canonicalCommit, retry_permitted: false, readback: summary};
  state.observations.authorization = summary;
  state.observations.reservation_attempted = false;
  saveState(state);
  appendJournal({operation: label, attempt: 1, tx: hash, ...summary});
  return {tx, summary, intent, authorization, vaultView, settlement, reservation};
}

async function continueLifecycle({client, account, state, abi, core, vault, intentId, latestFinal, evidence}: AnyRecord) {
  const canonicalIntent = asRecord(await read(client, core, "get_intent", [intentId], latestFinal));
  const canonicalAuthorization = asRecord(canonicalIntent.authorization);
  const canonicalVector = asRecord(canonicalAuthorization.vector);
  const authorizationActiveStatuses = ["AUTHORIZED", "FULFILLMENT_PENDING", "FULFILLED", "NOT_FULFILLED", "FULFILLMENT_RETRY_REQUIRED"];
  if (!authorizationActiveStatuses.includes(canonicalIntent.status) || canonicalAuthorization.schema !== AUTHORIZATION_V6_SCHEMA || !Array.isArray(canonicalAuthorization.failed_checks) || canonicalAuthorization.failed_checks.length !== 0 || !AUTHORIZATION_V6_FIELDS.every((field) => canonicalVector[field] === true)) {
    throw new Error("Reservation precondition failed: canonical V6 authorization is not all-true AUTHORIZED");
  }
  const authorizationView = asRecord(await read(client, core, "get_authorization_for_vault", [intentId], latestFinal));
  if (authorizationView.authorization_schema !== AUTHORIZATION_V6_SCHEMA || authorizationView.authorization_decision !== "AUTHORIZED") throw new Error("Vault authorization view does not match canonical V6 authorization");
  let reservation = asRecord(await read(client, vault, "get_reservation", [intentId], latestFinal));
  let accounting = asRecord(await read(client, vault, "get_accounting", ["M-1"], latestFinal));
  if (Object.keys(reservation).length === 0) {
    if (accounting.available !== "1" || accounting.reserved !== "0" || accounting.committed !== "0") throw new Error("Reservation precondition accounting mismatch");
    const result = await executeWrite({
      client, account, state, abi, label: "vault:reserve", address: vault, functionName: "reserve", args: [intentId],
      precondition: async () => {
        const intent = asRecord(await read(client, core, "get_intent", [intentId], latestFinal));
        const auth = asRecord(intent.authorization);
        const existing = asRecord(await read(client, vault, "get_reservation", [intentId], latestFinal));
        if (intent.status !== "AUTHORIZED" || auth.schema !== AUTHORIZATION_V6_SCHEMA || auth.decision !== "AUTHORIZED" || Object.keys(existing).length !== 0) throw new Error("Reservation canonical precondition changed");
      },
      postcondition: async () => {
        const item = asRecord(await read(client, vault, "get_reservation", [intentId], latestFinal));
        const ledger = asRecord(await read(client, vault, "get_accounting", ["M-1"], latestFinal));
        if (item.status !== "RESERVED" || item.intent_id !== intentId || item.mandate_id !== "M-1" || item.amount !== "1" || ledger.available !== "0" || ledger.reserved !== "1" || ledger.committed !== "1") throw new Error("Reservation canonical postcondition failed");
        return {reservation: item, accounting: ledger};
      },
    });
    reservation = result.readback.reservation;
    accounting = result.readback.accounting;
  } else {
    if (reservation.status !== "RESERVED" || reservation.intent_id !== intentId || reservation.amount !== "1") throw new Error("Existing reservation does not match the intended V6 authorization");
    if (accounting.available !== "0" || accounting.reserved !== "1" || accounting.committed !== "1") throw new Error("Existing reservation accounting does not match the canonical reservation");
  }

  let intent = asRecord(await read(client, core, "get_intent", [intentId], latestFinal));
  const startStep = state.steps["core:start_fulfillment"];
  if (startStep?.tx && startStep.status !== "COMPLETE") {
    const reconciledStart = await reconcileSameHash({client, hash: startStep.tx, interval: POLL_MS});
    if (!isSuccessful(reconciledStart.tx)) {
      state.steps["core:start_fulfillment"] = {...startStep, status: "ERROR", terminal_status: txStatus(reconciledStart.tx), execution: txExecution(reconciledStart.tx), execution_success: false, consensus_result: txConsensus(reconciledStart.tx)};
      saveState(state);
      throw new Error(`core:start_fulfillment existing transaction failed: status=${txStatus(reconciledStart.tx)} execution=${txExecution(reconciledStart.tx)}`);
    }
    if (intent.status !== "FULFILLMENT_PENDING") throw new Error(`core:start_fulfillment canonical postcondition discrepancy: status=${intent.status}`);
    state.steps["core:start_fulfillment"] = {...startStep, status: "COMPLETE", terminal_status: txStatus(reconciledStart.tx), execution: txExecution(reconciledStart.tx), execution_success: true, consensus_result: txConsensus(reconciledStart.tx), canonical_postcondition_met: true, readback: intent};
    saveState(state);
    appendJournal({operation: "core:start_fulfillment", tx: startStep.tx, status: txStatus(reconciledStart.tx), execution: txExecution(reconciledStart.tx), consensus: txConsensus(reconciledStart.tx), readback: intent, reconciled: true});
  }
  if (intent.status === "AUTHORIZED") {
    await executeWrite({
      client, account, state, abi, label: "core:start_fulfillment", address: core, functionName: "start_fulfillment", args: [intentId],
      precondition: async () => {
        const item = asRecord(await read(client, core, "get_intent", [intentId], latestFinal));
        const currentReservation = asRecord(await read(client, vault, "get_reservation", [intentId], latestFinal));
        if (item.status !== "AUTHORIZED" || currentReservation.status !== "RESERVED") throw new Error("Fulfillment start precondition is not canonical");
      },
      postcondition: async () => {
        const item = asRecord(await read(client, core, "get_intent", [intentId], latestFinal));
        if (item.status !== "FULFILLMENT_PENDING") throw new Error(`Fulfillment start ended in ${item.status}`);
        return item;
      },
    });
  }

  intent = asRecord(await read(client, core, "get_intent", [intentId], latestFinal));
  if (intent.status === "FULFILLMENT_PENDING") {
    let fulfillmentEvidence = asRecord(await read(client, core, "get_evidence", [intentId, 1n], latestFinal));
    if (Object.keys(fulfillmentEvidence).length === 0) {
      fulfillmentEvidence = asRecord((await executeWrite({
        client, account, state, abi, label: "core:define_evidence:fulfillment", address: core, functionName: "define_evidence",
        args: [intentId, "FULFILLMENT", EVIDENCE_URL, EVIDENCE_AUTHORITY, evidence.sha256, BigInt(evidence.byteLength), EVIDENCE_AUTHORITY, 1n],
        postcondition: async () => {
          const item = asRecord(await read(client, core, "get_evidence", [intentId, 1n], latestFinal));
          if (item.evidence_id !== "E-2" || item.committed_sha256 !== evidence.sha256 || item.committed_byte_length !== String(evidence.byteLength) || item.identity_fingerprint === "") throw new Error("Fulfillment evidence definition mismatch");
          return item;
        },
      })).readback);
    }
    if (state.steps["core:stage_evidence:fulfillment"]?.tx === undefined) {
      await executeWrite({
        client, account, state, abi, label: "core:stage_evidence:fulfillment", address: core, functionName: "stage_evidence", args: [intentId],
        postcondition: async () => {
          const item = asRecord(await read(client, core, "get_intent", [intentId], latestFinal));
          const definition = asRecord(await read(client, core, "get_evidence", [intentId, 1n], latestFinal));
          if (definition.committed_sha256 !== evidence.sha256 || definition.identity_fingerprint === "") throw new Error("Fulfillment evidence stage readback mismatch");
          return {intent: item, evidence: definition};
        },
      });
    }
  }

  intent = asRecord(await read(client, core, "get_intent", [intentId], latestFinal));
  if (intent.status === "FULFILLMENT_PENDING") {
    const assessmentStep = state.steps["core:assess_fulfillment"];
    if (assessmentStep?.tx) {
      // A terminal assessment with no canonical postcondition is history, not
      // permission to submit the same nondeterministic evaluation again.
      const reconciledAssessment = await reconcileSameHash({client, hash: assessmentStep.tx, interval: POLL_MS});
      const currentItem = asRecord(await read(client, core, "get_intent", [intentId], latestFinal));
      const currentReservation = asRecord(await read(client, vault, "get_reservation", [intentId], latestFinal));
      if (currentItem.status === "FULFILLMENT_PENDING" && currentReservation.status === "RESERVED") {
        const diagnostic = {
          hash: assessmentStep.tx,
          status: txStatus(reconciledAssessment.tx),
          execution: txExecution(reconciledAssessment.tx),
          consensus: txConsensus(reconciledAssessment.tx),
          successful_execution: isSuccessful(reconciledAssessment.tx),
          num_rounds: txRounds(reconciledAssessment.tx),
          rotation_count: txRotations(reconciledAssessment.tx),
          validators: consensusSummary(reconciledAssessment.tx),
          canonical_commit: false,
          intent_status: currentItem.status,
          reservation_status: currentReservation.status,
          retry_permitted: false,
          recovery_required: true,
        };
        state.steps["core:assess_fulfillment"] = {...assessmentStep, status: "RECONCILED_NO_CANONICAL_COMMIT", terminal_status: diagnostic.status, execution: diagnostic.execution, execution_success: diagnostic.successful_execution, consensus_result: diagnostic.consensus, canonical_postcondition_met: false, retry_permitted: false, readback: diagnostic};
        state.observations.fulfillment_assessment = diagnostic;
        saveState(state);
        appendJournal({operation: "core:assess_fulfillment", tx: assessmentStep.tx, ...diagnostic, reconciled: true});
        throw new Error("Fulfillment assessment has a terminal transaction but no canonical commit; explicit evidence recovery is required before another assessment");
      }
    } else {
      await executeWrite({
        client, account, state, abi, label: "core:assess_fulfillment", address: core, functionName: "assess_fulfillment", args: [intentId],
        precondition: async () => {
          const item = asRecord(await read(client, core, "get_intent", [intentId], latestFinal));
          const currentReservation = asRecord(await read(client, vault, "get_reservation", [intentId], latestFinal));
          if (item.status !== "FULFILLMENT_PENDING" || currentReservation.status !== "RESERVED") throw new Error("Fulfillment assessment precondition is not canonical");
        },
        postcondition: async () => {
          const item = asRecord(await read(client, core, "get_intent", [intentId], latestFinal));
          const fulfillment = asRecord(item.fulfillment);
          if (!["FULFILLED", "NOT_FULFILLED", "FULFILLMENT_RETRY_REQUIRED"].includes(item.status) || Object.keys(fulfillment).length === 0) throw new Error(`Fulfillment assessment ended in unexpected state ${item.status}`);
          return item;
        },
      });
    }
  }
  intent = asRecord(await read(client, core, "get_intent", [intentId], latestFinal));
  const fulfillment = asRecord(intent.fulfillment);
  const fulfillmentVector = asRecord(fulfillment.vector);
  const fulfillmentOutcome = fulfillmentVector.outcome ?? "UNAVAILABLE";
  if (intent.status === "FULFILLMENT_RETRY_REQUIRED") {
    return {status: "FULFILLMENT_RETRY_REQUIRED", intent, reservation, accounting, settlement: asRecord(await read(client, core, "get_settlement_instruction", [intentId], latestFinal)), externalObservation: "UNCONFIRMED", childTransactionIds: []};
  }
  if (intent.status !== "FULFILLED" && intent.status !== "NOT_FULFILLED") throw new Error(`Cannot settle from unexpected fulfillment state ${intent.status}`);
  const settlementInstruction = asRecord(await read(client, core, "get_settlement_instruction", [intentId], latestFinal));
  const readyAt = Number(settlementInstruction.ready_at ?? "0");
  while ((await chainTime(client)).chainNow < readyAt) {
    const now = (await chainTime(client)).chainNow;
    const remaining = Math.max(0, readyAt - now);
    console.log(`WAITING_FOR_SETTLEMENT_WINDOW_SECONDS=${remaining}`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_MS, Math.max(1000, remaining * 1000))));
  }
  const settlementMethod = intent.status === "FULFILLED" ? "request_release" : "request_refund";
  const settlementLabel = intent.status === "FULFILLED" ? "vault:request_release" : "vault:request_refund";
  let settlementReadback: AnyRecord;
  const currentReservation = asRecord(await read(client, vault, "get_reservation", [intentId], latestFinal));
  if (currentReservation.status === "RESERVED") {
    settlementReadback = (await executeWrite({
      client, account, state, abi, label: settlementLabel, address: vault, functionName: settlementMethod, args: [intentId],
      precondition: async () => {
        const currentInstruction = asRecord(await read(client, core, "get_settlement_instruction", [intentId], latestFinal));
        const currentTime = await chainTime(client);
        if (currentTime.chainNow < Number(currentInstruction.ready_at) || currentInstruction.direction !== (intent.status === "FULFILLED" ? "RELEASE_TO_COUNTERPARTY" : "REFUND_TO_PRINCIPAL")) throw new Error("Settlement precondition is not ready");
      },
      postcondition: async () => {
        const item = asRecord(await read(client, vault, "get_reservation", [intentId], latestFinal));
        const ledger = asRecord(await read(client, vault, "get_accounting", ["M-1"], latestFinal));
        const expectedStatus = intent.status === "FULFILLED" ? "RELEASE_PENDING" : "REFUND_PENDING";
        if (item.status !== expectedStatus || ledger.reserved !== "0" || (intent.status === "FULFILLED" ? ledger.release_pending !== "1" : ledger.refund_pending !== "1")) throw new Error("Settlement canonical postcondition failed");
        return {reservation: item, accounting: ledger};
      },
    })).readback;
  } else {
    const expectedStatus = intent.status === "FULFILLED" ? "RELEASE_PENDING" : "REFUND_PENDING";
    if (currentReservation.status !== expectedStatus) throw new Error(`Existing settlement state is ${currentReservation.status}, expected ${expectedStatus}`);
    settlementReadback = {reservation: currentReservation, accounting: asRecord(await read(client, vault, "get_accounting", ["M-1"], latestFinal))};
  }
  const settlementTx = state.steps[settlementLabel]?.tx ?? "";
  let childTransactionIds: string[] = [];
  const childResults: AnyRecord[] = [];
  if (settlementTx) {
    try {
      childTransactionIds = await getTriggeredTransactionIds({client, hash: settlementTx});
      for (const child of childTransactionIds) {
        const childReconciled = await reconcileSameHash({client, hash: child, interval: POLL_MS});
        childResults.push({hash: child, status: txStatus(childReconciled.tx), execution: txExecution(childReconciled.tx), successful: isSuccessful(childReconciled.tx)});
      }
    } catch (error: any) {
      childResults.push({status: "UNCONFIRMED", error: String(error?.message ?? error)});
    }
  }
  accounting = asRecord(await read(client, vault, "get_accounting", ["M-1"], latestFinal));
  reservation = asRecord(await read(client, vault, "get_reservation", [intentId], latestFinal));
  const settlement = reservation.settlement_id ? asRecord(await read(client, vault, "get_settlement", [reservation.settlement_id], latestFinal)) : {};
  const externalObservation = childResults.length > 0 && childResults.every((item) => item.successful === true) ? "OBSERVED_CHILD_SUCCESS_BUT_CONTRACT_FIELD_UNCONFIRMED" : "UNCONFIRMED";
  const result = {status: intent.status, fulfillment_outcome: fulfillmentOutcome, intent, fulfillment, fulfillment_vector: fulfillmentVector, reservation, accounting, settlement_instruction: settlementInstruction, settlement, settlement_tx: settlementTx, child_transaction_ids: childTransactionIds, child_results: childResults, external_observation: externalObservation, reservation_attempted: true};
  state.observations.lifecycle = result;
  state.observations.reservation_attempted = true;
  saveState(state);
  saveJson(path.join(ARTIFACT_DIR, "lifecycle-report.json"), result);
  return result;
}

async function preflight(deps: AnyRecord, state: State) {
  const {chains, createClient} = deps;
  const coreHash = sha256File(CORE_SOURCE);
  const vaultHash = sha256File(VAULT_SOURCE);
  if (coreHash !== CORE_SHA || vaultHash !== VAULT_SHA) throw new Error(`Qualified source drift: core=${coreHash} vault=${vaultHash}`);
  if (chains.studionet.id !== CHAIN_ID || chains.studionet.rpcUrls.default.http[0] !== RPC) throw new Error("Pinned SDK Studionet definition mismatch");
  const selected = findExpectedKeystore();
  if (selected.name !== EXPECTED_KEYSTORE || !sameAddress(selected.address, EXPECTED_SIGNER)) throw new Error("Expected deployment signer profile is not selected");
  const evidence = await liveEvidence();
  const client = createClient({chain: chains.studionet, endpoint: RPC, account: EXPECTED_SIGNER});
  const chainId = await client.getChainId();
  if (chainId !== CHAIN_ID) throw new Error(`RPC chain id is ${chainId}, expected ${CHAIN_ID}`);
  const balance = await client.getBalance({address: EXPECTED_SIGNER});
  const nonce = await client.getCurrentNonce({address: EXPECTED_SIGNER});
  const txs = await client.request({method: "sim_getTransactionsForAddress", params: [EXPECTED_SIGNER]});
  const terminal = new Set(["FINALIZED", "ACCEPTED", "REJECTED", "UNDETERMINED", "FAILED", "CANCELLED"]);
  const pending = txs.filter((item: AnyRecord) => !terminal.has(String(item?.status ?? "UNKNOWN").toUpperCase())).map((item: AnyRecord) => ({hash: item.hash, status: item.status}));
  if (pending.length > 0) throw new Error(`Unknown pending transactions exist: ${JSON.stringify(pending)}`);
  if (BigInt(balance) < AMOUNT) throw new Error("Deployment signer has insufficient GEN for the qualification deposit");
  state.observations.preflight = {network: NETWORK, rpc: RPC, chainId, signer: EXPECTED_SIGNER.toLowerCase(), keystore: selected.name, balance: String(balance), nonce: String(nonce), historical_transactions: txs.length, pending_transactions: pending.length, evidence, core_sha256: coreHash, vault_sha256: vaultHash};
  saveState(state);
  return {client, evidence};
}

async function run() {
  const deps = await loadPinnedDependencies();
  const state = loadState();
  const {abi, chains, createAccount, createClient, CalldataAddress, Wallet, prompt} = deps;
  const latestFinal = deps.TransactionHashVariant?.LATEST_FINAL ?? FALLBACK_LATEST_FINAL;
  const {evidence} = await preflight(deps, state);
  console.log(JSON.stringify({NETWORK, CHAIN_ID, CORE_SHA, VAULT_SHA, EVIDENCE_URL, EVIDENCE_SHA, EVIDENCE_BYTES, BALANCE: state.observations.preflight.balance, NONCE: state.observations.preflight.nonce, PENDING_TRANSACTIONS: state.observations.preflight.pending_transactions}, null, 2));
  if (process.argv.includes("--preflight-only")) return;

  const selected = findExpectedKeystore();
  console.log("PREFLIGHT=PASS");
  const loaded = await loadUnlockedAccount(Wallet, prompt, selected);
  const account = createAccount(loaded.wallet["private" + "Key"]);
  if (!sameAddress(account.address, EXPECTED_SIGNER)) throw new Error("Decrypted account address mismatch");
  const client = createClient({chain: chains.studionet, endpoint: RPC, account});
  if (process.argv.includes("--continue-release")) {
    const core = state.core;
    const vault = state.vault;
    const intentId = "I-2";
    if (!core || !vault || state.steps["core:authorize_intent"]?.canonical_postcondition_met !== true || state.authorization?.submission_count !== 1) throw new Error("Continuation checkpoint does not prove the completed V6 authorization state");
    const lifecycle = await continueLifecycle({client, account, state, abi, core, vault, intentId, latestFinal, evidence});
    const prior = state.observations.final ?? {};
    const report = {...prior, network: NETWORK, chain_id: CHAIN_ID, core, vault, fresh_intent_id: intentId, lifecycle, reservation_attempted: lifecycle.reservation_attempted === true, stopped_after_authorization_reconciliation: false};
    state.observations.final = report;
    saveState(state);
    saveJson(path.join(ARTIFACT_DIR, "final-report.json"), report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const coreDeploy = await executeDeploy({client, account, state, label: "deploy:v6-core", sourcePath: CORE_SOURCE, expectedHash: CORE_SHA, args: [], summary: [{type: "source", sha256: CORE_SHA}]});
  const core = coreDeploy.address;
  state.core = core;
  saveState(state);
  const vaultDeploy = await executeDeploy({client, account, state, label: "deploy:v6-vault", sourcePath: VAULT_SOURCE, expectedHash: VAULT_SHA, args: [calldataAddress(CalldataAddress, core)], summary: [{type: "constructor_core_address", value: core}]});
  const vault = vaultDeploy.address;
  state.vault = vault;
  saveState(state);
  if (!sameAddress(await read(client, vault, "get_core_address", [], latestFinal), core)) throw new Error("Vault constructor Core binding mismatch");
  await executeWrite({client, account, state, abi, label: "vault:bind_core", address: vault, functionName: "bind_core", args: [], postcondition: async () => ({core: await read(client, vault, "get_core_address", [], latestFinal)})});
  await executeWrite({client, account, state, abi, label: "core:set_vault_address", address: core, functionName: "set_vault_address", args: [calldataAddress(CalldataAddress, vault)], postcondition: async () => ({vault: await read(client, core, "get_vault_address", [], latestFinal)})});
  const boundCore = await read(client, core, "get_vault_address", [], latestFinal);
  const boundVault = await read(client, vault, "get_core_address", [], latestFinal);
  if (!sameAddress(boundCore, vault) || !sameAddress(boundVault, core)) throw new Error("Bidirectional Core/Vault binding mismatch");
  state.observations.binding = {core, vault, core_to_vault: boundCore, vault_to_core: boundVault, verified: true};
  saveState(state);

  await executeWrite({client, account, state, abi, label: "core:register_principal", address: core, functionName: "register_principal", args: [], postcondition: async () => ({registered: true, signer: EXPECTED_SIGNER.toLowerCase()})});
  await executeWrite({client, account, state, abi, label: "core:register_agent", address: core, functionName: "register_agent", args: [calldataAddress(CalldataAddress, EXPECTED_SIGNER), "PAVEL V6 qualification agent"], postcondition: async () => ({registered: true, agent: EXPECTED_SIGNER.toLowerCase()})});
  await executeWrite({client, account, state, abi, label: "core:register_counterparty", address: core, functionName: "register_counterparty", args: [calldataAddress(CalldataAddress, EXPECTED_SIGNER), "GenLayer documentation", EVIDENCE_URL], postcondition: async () => asRecord(await read(client, core, "get_counterparty", ["C-1"], latestFinal))});
  const timeBeforeMandate = await chainTime(client);
  const validFrom = timeBeforeMandate.chainNow + SEAL_MARGIN_SECONDS;
  const expiresAt = validFrom + MANDATE_HORIZON_SECONDS;
  const mandateArgs = ["M-1", "PAVEL V6 semantic authorization qualification", "Authorize a bounded GenLayer use-case qualification under the sealed mandate.", "The principal retains control; only the registered agent may submit the bounded qualification intent.", "Evaluate the GenLayer protocol use-case deliverable described by the authenticated evidence.", "No unrelated activity, recipient change, budget expansion, or external transfer beyond the bounded qualification.", AMOUNT, AMOUNT, 86400n, AMOUNT, BigInt(validFrom), BigInt(expiresAt), 300n, "Authenticated HTTPS evidence is required before authorization.", EVIDENCE_AUTHORITY, "The requested use-case deliverable must be supported by the authenticated evidence before reservation.", "Use only the approved docs.genlayer.com authority for recovery.", false];
  await executeWrite({client, account, state, abi, label: "core:create_mandate", address: core, functionName: "create_mandate", args: [calldataAddress(CalldataAddress, EXPECTED_SIGNER), ""], postcondition: async () => asRecord(await read(client, core, "get_mandate", ["M-1"], latestFinal))});
  await executeWrite({client, account, state, abi, label: "core:configure_mandate", address: core, functionName: "configure_mandate", args: mandateArgs, postcondition: async () => asRecord(await read(client, core, "get_mandate", ["M-1"], latestFinal))});
  await executeWrite({client, account, state, abi, label: "core:seal_mandate", address: core, functionName: "seal_mandate", args: ["M-1"], postcondition: async () => asRecord(await read(client, core, "get_mandate", ["M-1"], latestFinal))});
  let mandate = asRecord(await read(client, core, "get_mandate", ["M-1"], latestFinal));
  if (mandate.status !== "SEALED") throw new Error(`Mandate status is ${mandate.status}, not SEALED`);
  while ((await chainTime(client)).chainNow < Number(mandate.valid_from)) {
    const remaining = Number(mandate.valid_from) - (await chainTime(client)).chainNow;
    console.log(`WAITING_FOR_MANDATE_ACTIVATION_SECONDS=${Math.max(0, remaining)}`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_MS, Math.max(1000, remaining * 1000))));
  }
  mandate = asRecord(await read(client, core, "get_mandate", ["M-1"], latestFinal));
  await executeWrite({client, account, state, abi, label: "vault:deposit", address: vault, functionName: "deposit", args: ["M-1"], value: AMOUNT, postcondition: async () => asRecord(await read(client, vault, "get_accounting", ["M-1"], latestFinal))});
  const accounting = asRecord(await read(client, vault, "get_accounting", ["M-1"], latestFinal));
  if (accounting.deposited !== "1" || accounting.conserved !== true || !((accounting.available === "1" && accounting.reserved === "0" && accounting.committed === "0") || (accounting.available === "0" && accounting.reserved === "1" && accounting.committed === "1"))) throw new Error("V6 deposit accounting precondition failed");
  const intentExpiry = Math.min(Number(mandate.expires_at), (await chainTime(client)).chainNow + 7200);
  const intentFields = ["M-1", "C-1", calldataAddress(CalldataAddress, EXPECTED_SIGNER), AMOUNT, "V6 GenLayer use-case qualification", "Assess whether the documented GenLayer use-case deliverable is aligned with the mandate.", "A bounded semantic authorization result for the GenLayer use-case deliverable.", "Qualification amount is exactly 1 GEN with no unapproved commercial expansion.", "Authenticated evidence must support the requested use-case deliverable before reservation.", BigInt(intentExpiry)];
  await executeWrite({client, account, state, abi, label: "core:create_intent:sentinel", address: core, functionName: "create_intent", args: ["M-1", "C-1", calldataAddress(CalldataAddress, EXPECTED_SIGNER), AMOUNT, "V6 ID allocation sentinel", "Reserved fresh V6 ID allocation only.", "No deliverable; this draft is never submitted.", "No commercial action.", "No fulfillment.", BigInt(intentExpiry)], postcondition: async () => asRecord(await read(client, core, "get_intent", ["I-1"], latestFinal))});
  const intentId = "I-2";
  await executeWrite({client, account, state, abi, label: "core:create_intent", address: core, functionName: "create_intent", args: intentFields, postcondition: async () => asRecord(await read(client, core, "get_intent", [intentId], latestFinal))});
  await executeWrite({client, account, state, abi, label: "core:submit_intent", address: core, functionName: "submit_intent", args: [intentId], postcondition: async () => asRecord(await read(client, core, "get_intent", [intentId], latestFinal))});
  await executeWrite({client, account, state, abi, label: "core:define_evidence", address: core, functionName: "define_evidence", args: [intentId, "PRODUCT_SERVICE", EVIDENCE_URL, EVIDENCE_AUTHORITY, EVIDENCE_SHA, BigInt(EVIDENCE_BYTES), EVIDENCE_AUTHORITY, 0n], postcondition: async () => asRecord(await read(client, core, "get_evidence", [intentId, 0n], latestFinal))});
  await executeWrite({client, account, state, abi, label: "core:stage_evidence", address: core, functionName: "stage_evidence", args: [intentId], postcondition: async () => asRecord(await read(client, core, "get_intent", [intentId], latestFinal))});
  const staged = asRecord(await read(client, core, "get_intent", [intentId], latestFinal));
  if (!state.steps["core:stage_evidence"]?.tx && staged.status !== "EVIDENCE_READY") throw new Error(`V6 evidence stage ended in ${staged.status}`);
  const auth = await executeAuthorization({client, account, state, abi, core, intentId, latestFinal});
  if (auth.summary.canonical_commit !== true || auth.summary.authorization_schema !== AUTHORIZATION_V6_SCHEMA || auth.summary.failed_checks.length !== 0 || !AUTHORIZATION_V6_FIELDS.every((field) => auth.summary.authorization_vector[field] === true)) throw new Error("V6 authorization did not produce the required canonical all-true state");
  const lifecycle = await continueLifecycle({client, account, state, abi, core, vault, intentId, latestFinal, evidence});
  const report = {
    network: NETWORK,
    chain_id: CHAIN_ID,
    core,
    vault,
    mandate_id: "M-1",
    mandate_status: mandate.status,
    fresh_intent_id: intentId,
    evidence_id: asRecord(await read(client, core, "get_evidence", [intentId, 0n], latestFinal)).evidence_id ?? "MISSING",
    evidence_sha256: EVIDENCE_SHA,
    evidence_byte_length: EVIDENCE_BYTES,
    evidence_status: staged.status,
    authorization: auth.summary,
    lifecycle,
    reservation_attempted: lifecycle.reservation_attempted === true,
    stopped_after_authorization_reconciliation: false,
  };
  state.observations.final = report;
  saveState(state);
  saveJson(path.join(ARTIFACT_DIR, "final-report.json"), report);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
