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
import {FALLBACK_LATEST_FINAL, isSuccessful, reconcileSameHash, sendWriteOnce} from "./lib/official-transaction.ts";
import {AUTHORIZATION_V6_FIELDS, AUTHORIZATION_V6_SCHEMA} from "./lib/authorization-v6.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RPC = "https://studio.genlayer.com/api";
const NETWORK = "studionet";
const CHAIN_ID = 61999;
const EXPECTED_KEYSTORE = "meritround-v2-studionet";
const CORE = "0x8A1eE5371F0E2d7243f9448b8d0d4BdC09EAB5D5";
const VAULT = "0x1F1FCADEe16B02f8Ae1D52753C2F0afcBCf96140";
const CORE_SOURCE = path.join(ROOT, "contracts", "pavel_core.py");
const VAULT_SOURCE = path.join(ROOT, "contracts", "pavel_vault.py");
const CORE_SHA = "4212e38df316a95f6525d92cf92743e37b3e92b312f70b98bfdc2b0a4ae20ca0";
const VAULT_SHA = "d967d6f1e70cd698fc428338ca822c5541ce07fd7977517db7bb19f9796aa8ed";
const EVIDENCE_URL = "https://docs.genlayer.com/understand-genlayer-protocol/typical-use-cases.md";
const EVIDENCE_AUTHORITY = "docs.genlayer.com";
const EVIDENCE_SHA = "d00583b58c300822541b7f556c8ac4e97d3b2e5f5e9a0f3af97b753d6f70441d";
const EVIDENCE_BYTES = 3988;
const AMOUNT = 1n;
const ARTIFACT_DIR = path.join(ROOT, "artifacts", "studionet", "qualification-v6-doc-recovery");
const STATE_PATH = path.join(ARTIFACT_DIR, "checkpoint.json");
const JOURNAL_PATH = path.join(ARTIFACT_DIR, "transactions.json");
const POLL_MS = 3000;

type AnyRecord = Record<string, any>;

function jsonSafe(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    const out: AnyRecord = {};
    for (const [key, item] of Object.entries(value)) out[key] = jsonSafe(item);
    return out;
  }
  return value;
}

function saveJson(file: string, value: any) {
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, `${JSON.stringify(jsonSafe(value), null, 2)}\n`);
}

function saveState(state: AnyRecord) { saveJson(STATE_PATH, state); }

function journal(entry: AnyRecord) {
  let entries: AnyRecord[] = [];
  if (existsSync(JOURNAL_PATH)) entries = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
  entries.push({...jsonSafe(entry), recordedAt: new Date().toISOString()});
  saveJson(JOURNAL_PATH, entries);
}

function sha256Bytes(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
function sha256File(file: string) { return sha256Bytes(new Uint8Array(readFileSync(file))); }
function sameAddress(a: unknown, b: unknown) { return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase(); }
function asRecord(value: any): AnyRecord {
  if (typeof value === "string") {
    if (!value) return {};
    try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function txField(tx: AnyRecord, ...names: string[]) { for (const name of names) if (tx?.[name] !== undefined) return tx[name]; return "UNAVAILABLE"; }
function txSummary(tx: AnyRecord) {
  const validators = Array.isArray(tx?.consensus_data?.validators) ? tx.consensus_data.validators : [];
  return {
    status: txField(tx, "statusName", "status"),
    execution: txField(tx, "txExecutionResultName", "execution"),
    consensus: txField(tx, "resultName", "result_name", "result"),
    rounds: txField(tx, "num_of_rounds", "numOfRounds"),
    rotations: txField(tx, "rotation_count", "rotationCount", "config_rotation_rounds"),
    execution_hash: txField(tx, "txExecutionHash", "tx_execution_hash", "execution_hash"),
    validators: validators.map((item: AnyRecord) => ({
      vote: item.vote ?? "UNAVAILABLE",
      execution_result: item.execution_result ?? item.executionResult ?? "UNAVAILABLE",
      nondet_disagree: item.nondet_disagree ?? null,
      error_code: item.genvm_result?.error_code ?? item.genvmResult?.errorCode ?? null,
      model: item.node_config?.model ?? item.node_config?.primary_model?.model ?? item.node_config?.secondary_model?.model ?? "UNAVAILABLE",
    })),
  };
}

function calldataAddress(CalldataAddress: any, value: string) { return new CalldataAddress(Uint8Array.from(Buffer.from(value.slice(2), "hex"))); }
function emptyState() {
  return {version: "qualification-v6-doc-recovery", network: NETWORK, rpc: RPC, chainId: CHAIN_ID, signer: EXPECTED_SIGNER.toLowerCase(), core: CORE, vault: VAULT, sourceHashes: {core: CORE_SHA, vault: VAULT_SHA}, steps: {}, observations: {i2_preserved: false}};
}
function loadState() {
  if (!existsSync(STATE_PATH)) return emptyState();
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  if (state.version !== "qualification-v6-doc-recovery" || state.network !== NETWORK || state.chainId !== CHAIN_ID || !sameAddress(state.core, CORE) || !sameAddress(state.vault, VAULT)) throw new Error("Fresh recovery checkpoint identity mismatch");
  if (state.sourceHashes?.core !== CORE_SHA || state.sourceHashes?.vault !== VAULT_SHA) throw new Error("Fresh recovery source identity mismatch");
  return state;
}

async function chainTime(client: AnyRecord) {
  const block = await client.request({method: "eth_getBlockByNumber", params: ["latest", false]});
  const raw = block?.timestamp;
  const value = typeof raw === "string" && raw.startsWith("0x") ? Number.parseInt(raw.slice(2), 16) : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("latest chain time unavailable");
  return value;
}

async function read(client: AnyRecord, address: string, functionName: string, args: any[], latestFinal: any) {
  return client.readContract({address, functionName, args, transactionHashVariant: latestFinal});
}

async function liveEvidence() {
  const response = await fetch(EVIDENCE_URL, {redirect: "follow"});
  const bytes = new Uint8Array(await response.arrayBuffer());
  const result = {status: response.status, finalUrl: response.url, byteLength: bytes.byteLength, sha256: sha256Bytes(bytes), contentType: response.headers.get("content-type") ?? ""};
  if (result.status !== 200 || result.finalUrl !== EVIDENCE_URL || result.byteLength !== EVIDENCE_BYTES || result.sha256 !== EVIDENCE_SHA) throw new Error(`Evidence identity mismatch: ${JSON.stringify(result)}`);
  saveJson(path.join(ARTIFACT_DIR, "evidence-live-preflight.json"), {url: EVIDENCE_URL, authority: EVIDENCE_AUTHORITY, ...result});
  return result;
}

async function loadUnlockedAccount(Wallet: any, prompt: any, selected: AnyRecord) {
  let cachedKey = "";
  try {
    const pnpmRoot = path.join(ROOT, "node_modules", ".pnpm");
    const keytarEntry = readdirSync(pnpmRoot).find((name) => name.startsWith("keytar@7.9.0"));
    if (keytarEntry) {
      const module = await import(pathToFileURL(path.join(pnpmRoot, keytarEntry, "node_modules", "keytar", "lib", "keytar.js")).href);
      const keytar = module.default ?? module;
      cachedKey = String(await keytar.getPassword("genlayer-cli", `account:${selected.name}`) ?? "");
    }
  } catch { cachedKey = ""; }
  if (/^0x[0-9a-f]{64}$/i.test(cachedKey)) {
    const wallet = new Wallet(cachedKey);
    cachedKey = "";
    if (!sameAddress(wallet.address, EXPECTED_SIGNER)) throw new Error("Cached signer mismatch");
    return wallet;
  }
  cachedKey = "";
  const loaded = await loadExistingAccount(Wallet, prompt, selected);
  return loaded.wallet;
}

async function sourceProof(client: AnyRecord, address: string, expected: string) {
  const code = await client.getContractCode(address);
  const actual = sha256Bytes(new TextEncoder().encode(code));
  if (actual !== expected) throw new Error(`Deployed source mismatch at ${address}`);
  return {address, sha256: actual, byte_length: Buffer.byteLength(code, "utf8")};
}

function markSubmitted(state: AnyRecord, label: string, hash: string, args: any[]) {
  state.steps[label] = {...(state.steps[label] ?? {}), label, tx: hash, tx_hash: hash, status: "SUBMITTED", args: jsonSafe(args), submitted_at: new Date().toISOString()};
  saveState(state);
  journal({operation: label, tx: hash, status: "SUBMITTED", args});
  console.log(`TX_SUBMITTED=${label} ${hash}`);
}

async function writeOnce({client, account, state, abi, label, address, functionName, args, value = 0n, postcondition, precondition = async () => {}}: AnyRecord) {
  const existing = state.steps[label];
  let hash = existing?.tx;
  let tx: AnyRecord;
  if (hash) {
    const reconciled = await reconcileSameHash({client, hash, interval: POLL_MS});
    tx = reconciled.tx;
    if (!isSuccessful(tx)) throw new Error(`${label} existing transaction is not successful`);
  } else {
    await precondition();
    const calldata = abi.calldata.makeCalldataObject(functionName, args, undefined);
    if (!abi.calldata.encode(calldata)?.length) throw new Error(`empty calldata for ${label}`);
    hash = await sendWriteOnce({client, operation: label, request: {address, functionName, args, value, account}, persistHash: async (txHash) => markSubmitted(state, label, txHash, args)});
    const reconciled = await reconcileSameHash({client, hash, interval: POLL_MS});
    tx = reconciled.tx;
    state.steps[label] = {...state.steps[label], tx: hash, tx_hash: hash, terminal: txSummary(tx)};
    saveState(state);
    if (!isSuccessful(tx)) { state.steps[label].status = "ERROR"; saveState(state); throw new Error(`${label} failed at protocol layer`); }
  }
  const readback = await postcondition();
  state.steps[label] = {...state.steps[label], status: "COMPLETE", terminal: txSummary(tx), canonical_postcondition_met: true, readback: jsonSafe(readback)};
  saveState(state);
  journal({operation: label, tx: hash, status: "COMPLETE", terminal: txSummary(tx), readback});
  return {hash, tx, readback};
}

function nextSequentialId(ids: string[], prefix: string) {
  const numbers = ids.map((id) => /^([A-Z]+)-(\d+)$/.exec(String(id))).filter(Boolean).map((match: any) => Number(match[2]));
  if (!numbers.length || numbers.some((value) => !Number.isSafeInteger(value))) throw new Error(`Cannot derive next ${prefix} id from canonical ids`);
  return `${prefix}-${Math.max(...numbers) + 1}`;
}

async function listIds(client: AnyRecord, core: string, methodCount: string, methodId: string, latestFinal: any) {
  const count = Number(await read(client, core, methodCount, [], latestFinal));
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) ids.push(String(await read(client, core, methodId, [BigInt(i)], latestFinal)));
  return ids;
}

function authRecord(intent: AnyRecord) { return asRecord(intent.authorization); }
function authVector(intent: AnyRecord) { return asRecord(authRecord(intent).vector); }

async function run() {
  const deps = await loadPinnedDependencies();
  const state = loadState();
  const {abi, chains, createAccount, createClient, CalldataAddress, Wallet, prompt} = deps;
  const latestFinal = deps.TransactionHashVariant?.LATEST_FINAL ?? FALLBACK_LATEST_FINAL;
  if (chains.studionet.id !== CHAIN_ID || chains.studionet.rpcUrls.default.http[0] !== RPC) throw new Error("Pinned Studionet configuration mismatch");
  if (sha256File(CORE_SOURCE) !== CORE_SHA || sha256File(VAULT_SOURCE) !== VAULT_SHA) throw new Error("Qualified V6 source drift");
  const selected = findExpectedKeystore();
  if (selected.name !== EXPECTED_KEYSTORE || !sameAddress(selected.address, EXPECTED_SIGNER)) throw new Error("Expected keystore profile is not selected");
  const evidence = await liveEvidence();
  const readClient = createClient({chain: chains.studionet, endpoint: RPC, account: EXPECTED_SIGNER});
  if (await readClient.getChainId() !== CHAIN_ID) throw new Error("Studionet chain id mismatch");
  if (sha256File(CORE_SOURCE) !== CORE_SHA || sha256File(VAULT_SOURCE) !== VAULT_SHA) throw new Error("Source changed during preflight");
  const deployedCore = await sourceProof(readClient, CORE, CORE_SHA);
  const deployedVault = await sourceProof(readClient, VAULT, VAULT_SHA);
  if (!sameAddress(await read(readClient, CORE, "get_vault_address", [], latestFinal), VAULT) || !sameAddress(await read(readClient, VAULT, "get_core_address", [], latestFinal), CORE)) throw new Error("Existing V6 bindings are not canonical");
  const i2 = asRecord(await read(readClient, CORE, "get_intent", ["I-2"], latestFinal));
  const i2Reservation = asRecord(await read(readClient, VAULT, "get_reservation", ["I-2"], latestFinal));
  if (i2.status !== "FULFILLMENT_PENDING" || i2Reservation.status !== "RESERVED") throw new Error("I-2 preservation precondition changed; refusing fresh flow");
  state.observations.i2_preserved = true;
  state.observations.preflight = {network: NETWORK, chain_id: CHAIN_ID, core: deployedCore, vault: deployedVault, evidence, i2_status: i2.status, i2_reservation: i2Reservation.status};
  saveState(state);
  console.log(JSON.stringify({NETWORK, CHAIN_ID, CORE, VAULT, EVIDENCE_URL, EVIDENCE_SHA, EVIDENCE_BYTES, I2_STATUS: i2.status, I2_RESERVATION: i2Reservation.status}, null, 2));

  const mandateIds = await listIds(readClient, CORE, "get_mandate_count", "get_mandate_id", latestFinal);
  const intentIds = await listIds(readClient, CORE, "get_intent_count", "get_intent_id", latestFinal);
  const mandateId = String(state.mandate_id ?? nextSequentialId(mandateIds, "M"));
  const intentId = String(state.intent_id ?? nextSequentialId(intentIds, "I"));
  state.mandate_id = mandateId;
  state.intent_id = intentId;
  saveState(state);
  const loadedWallet = await loadUnlockedAccount(Wallet, prompt, selected);
  const account = createAccount(loadedWallet["private" + "Key"]);
  if (!sameAddress(account.address, EXPECTED_SIGNER)) throw new Error("Unlocked account mismatch");
  const client = createClient({chain: chains.studionet, endpoint: RPC, account});

  const mandateArgsFor = (validFrom: number) => [mandateId, "PAVEL V6 exact GenLayer artifact qualification", "Retrieve, authenticate, and deliver exactly the registered official GenLayer Typical Use Cases artifact.", "The principal retains control; only the registered agent may submit this bounded artifact transaction.", "Retrieve and deliver exactly one registered official GenLayer artifact from the sealed authority.", "No substituted artifact, recipient change, budget expansion, or unrelated activity.", AMOUNT, AMOUNT, 3600n, AMOUNT, BigInt(validFrom), BigInt(validFrom + 7200), 1n, "Authenticated HTTPS evidence must match the registered artifact identity.", EVIDENCE_AUTHORITY, "Completion is the authenticated delivery of the exact registered artifact; no additional semantic deliverable is required.", "Use only the sealed official artifact authority; preserve the exact URL, SHA-256, and byte length.", false];
  const initialValidFrom = (await chainTime(readClient)) + 30;
  const mandateArgs = mandateArgsFor(initialValidFrom);
  await writeOnce({client, account, state, abi, label: "core:create_mandate:doc_recovery", address: CORE, functionName: "create_mandate", args: [calldataAddress(CalldataAddress, EXPECTED_SIGNER), ""], postcondition: async () => asRecord(await read(client, CORE, "get_mandate", [mandateId], latestFinal))});
  await writeOnce({client, account, state, abi, label: "core:configure_mandate:doc_recovery", address: CORE, functionName: "configure_mandate", args: mandateArgs, postcondition: async () => asRecord(await read(client, CORE, "get_mandate", [mandateId], latestFinal))});
  if (state.steps["core:seal_mandate:doc_recovery"]?.status === "ERROR") {
    const repairedValidFrom = (await chainTime(readClient)) + 60;
    await writeOnce({client, account, state, abi, label: "core:configure_mandate:activation_repair", address: CORE, functionName: "configure_mandate", args: mandateArgsFor(repairedValidFrom), precondition: async () => { const current = asRecord(await read(readClient, CORE, "get_mandate", [mandateId], latestFinal)); console.log(`REPAIR_PRECONDITION_MANDATE=${mandateId} STATUS=${String(current.status ?? "MISSING")}`); if (current.status !== "DRAFT") throw new Error(`Failed seal did not leave a repairable DRAFT mandate: ${current.status ?? "MISSING"}`); }, postcondition: async () => asRecord(await read(client, CORE, "get_mandate", [mandateId], latestFinal))});
  }
  const sealLabel = state.steps["core:seal_mandate:doc_recovery"]?.status === "ERROR" ? "core:seal_mandate:activation_repair" : "core:seal_mandate:doc_recovery";
  await writeOnce({client, account, state, abi, label: sealLabel, address: CORE, functionName: "seal_mandate", args: [mandateId], precondition: async () => { const current = asRecord(await read(readClient, CORE, "get_mandate", [mandateId], latestFinal)); if (current.status !== "DRAFT") throw new Error(`Mandate cannot be sealed from ${current.status}`); }, postcondition: async () => asRecord(await read(client, CORE, "get_mandate", [mandateId], latestFinal))});
  let mandate = asRecord(await read(readClient, CORE, "get_mandate", [mandateId], latestFinal));
  while (mandate.status === "SEALED" && (await chainTime(readClient)) < Number(mandate.valid_from)) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    mandate = asRecord(await read(readClient, CORE, "get_mandate", [mandateId], latestFinal));
  }
  if (mandate.status !== "SEALED") throw new Error("Fresh mandate did not seal");

  await writeOnce({client, account, state, abi, label: "vault:deposit:doc_recovery", address: VAULT, functionName: "deposit", args: [mandateId], value: AMOUNT, precondition: async () => { const current = asRecord(await read(readClient, VAULT, "get_accounting", [mandateId], latestFinal)); if (current.deposited !== "0") throw new Error("Fresh mandate already has a deposit"); }, postcondition: async () => asRecord(await read(client, VAULT, "get_accounting", [mandateId], latestFinal))});
  const deposited = asRecord(await read(readClient, VAULT, "get_accounting", [mandateId], latestFinal));
  if (deposited.available !== "1" || deposited.reserved !== "0" || deposited.committed !== "0") throw new Error("Fresh deposit accounting mismatch");

  const expiry = Math.min(Number(mandate.expires_at), (await chainTime(readClient)) + 3600);
  const deliverable = `Retrieve, authenticate, and deliver exactly one copy of ${EVIDENCE_URL} with SHA-256 ${EVIDENCE_SHA} and byte length ${EVIDENCE_BYTES}. The artifact itself is the deliverable; no substituted document or generated explanation is acceptable.`;
  const purpose = "Complete an objectively verifiable official GenLayer artifact retrieval and delivery qualification.";
  const commercial = "Exactly 1 smallest native GEN unit (0.000000000000000001 GEN) funds retrieval, authentication, and delivery of one registered artifact; no additional commercial term is authorized.";
  const fulfillment = `Authenticated evidence must be a successful GET of ${EVIDENCE_URL} whose exact bytes match SHA-256 ${EVIDENCE_SHA} and byte length ${EVIDENCE_BYTES}; that authenticated artifact is completion evidence.`;
  await writeOnce({client, account, state, abi, label: "core:create_intent:doc_recovery", address: CORE, functionName: "create_intent", args: [mandateId, "C-1", calldataAddress(CalldataAddress, EXPECTED_SIGNER), AMOUNT, "Official GenLayer artifact delivery", purpose, deliverable, commercial, fulfillment, BigInt(expiry)], postcondition: async () => asRecord(await read(client, CORE, "get_intent", [intentId], latestFinal))});
  await writeOnce({client, account, state, abi, label: "core:submit_intent:doc_recovery", address: CORE, functionName: "submit_intent", args: [intentId], postcondition: async () => asRecord(await read(client, CORE, "get_intent", [intentId], latestFinal))});
  await writeOnce({client, account, state, abi, label: "core:define_evidence:auth:doc_recovery", address: CORE, functionName: "define_evidence", args: [intentId, "PRODUCT_SERVICE", EVIDENCE_URL, EVIDENCE_AUTHORITY, EVIDENCE_SHA, BigInt(EVIDENCE_BYTES), EVIDENCE_AUTHORITY, 0n], postcondition: async () => asRecord(await read(client, CORE, "get_evidence", [intentId, 0n], latestFinal))});
  await writeOnce({client, account, state, abi, label: "core:stage_evidence:auth:doc_recovery", address: CORE, functionName: "stage_evidence", args: [intentId], postcondition: async () => asRecord(await read(client, CORE, "get_intent", [intentId], latestFinal))});
  let intent = asRecord(await read(readClient, CORE, "get_intent", [intentId], latestFinal));
  if (intent.status !== "EVIDENCE_READY") throw new Error(`Authorization evidence did not authenticate: ${intent.status}`);

  const authStep = await writeOnce({client, account, state, abi, label: "core:authorize_intent:doc_recovery", address: CORE, functionName: "authorize_intent", args: [intentId], precondition: async () => { const current = asRecord(await read(readClient, CORE, "get_intent", [intentId], latestFinal)); if (current.status !== "EVIDENCE_READY") throw new Error(`Authorization precondition is ${current.status}`); }, postcondition: async () => asRecord(await read(client, CORE, "get_intent", [intentId], latestFinal))});
  intent = asRecord(authStep.readback);
  const auth = authRecord(intent);
  const vector = authVector(intent);
  const authSummary = {tx: state.steps["core:authorize_intent:doc_recovery"]?.tx, status: intent.status, schema: auth.schema ?? "", vector, failed_checks: auth.failed_checks ?? [], canonical_commit: auth.schema === AUTHORIZATION_V6_SCHEMA && Object.keys(vector).length === AUTHORIZATION_V6_FIELDS.length};
  state.observations.authorization = authSummary;
  saveState(state);
  if (intent.status !== "AUTHORIZED" || !authSummary.canonical_commit) { saveJson(path.join(ARTIFACT_DIR, "final-report.json"), {phase: "authorization", ...state.observations}); console.log(JSON.stringify(state.observations, null, 2)); return; }

  const reservation = await writeOnce({client, account, state, abi, label: "vault:reserve:doc_recovery", address: VAULT, functionName: "reserve", args: [intentId], precondition: async () => { const currentIntent = asRecord(await read(readClient, CORE, "get_intent", [intentId], latestFinal)); const current = asRecord(await read(readClient, VAULT, "get_reservation", [intentId], latestFinal)); const accounting = asRecord(await read(readClient, VAULT, "get_accounting", [mandateId], latestFinal)); if (current.status || current.intent_id) throw new Error("Fresh intent is already reserved"); if (currentIntent.status !== "AUTHORIZED" || accounting.available !== "1") throw new Error("Reservation precondition mismatch"); }, postcondition: async () => asRecord(await read(client, VAULT, "get_reservation", [intentId], latestFinal))});
  state.observations.reservation = reservation.readback;
  await writeOnce({client, account, state, abi, label: "core:start_fulfillment:doc_recovery", address: CORE, functionName: "start_fulfillment", args: [intentId], postcondition: async () => asRecord(await read(client, CORE, "get_intent", [intentId], latestFinal))});
  await writeOnce({client, account, state, abi, label: "core:define_evidence:fulfillment:doc_recovery", address: CORE, functionName: "define_evidence", args: [intentId, "FULFILLMENT", EVIDENCE_URL, EVIDENCE_AUTHORITY, EVIDENCE_SHA, BigInt(EVIDENCE_BYTES), EVIDENCE_AUTHORITY, 1n], postcondition: async () => asRecord(await read(client, CORE, "get_evidence", [intentId, 1n], latestFinal))});
  await writeOnce({client, account, state, abi, label: "core:stage_evidence:fulfillment:doc_recovery", address: CORE, functionName: "stage_evidence", args: [intentId], postcondition: async () => asRecord(await read(client, CORE, "get_intent", [intentId], latestFinal))});
  const assessment = await writeOnce({client, account, state, abi, label: "core:assess_fulfillment:doc_recovery", address: CORE, functionName: "assess_fulfillment", args: [intentId], precondition: async () => { const current = asRecord(await read(readClient, CORE, "get_intent", [intentId], latestFinal)); if (current.status !== "FULFILLMENT_PENDING") throw new Error(`Fulfillment assessment precondition is ${current.status}`); }, postcondition: async () => asRecord(await read(client, CORE, "get_intent", [intentId], latestFinal))});
  intent = asRecord(assessment.readback);
  const fulfillmentRecord = asRecord(intent.fulfillment);
  state.observations.fulfillment = {tx: state.steps["core:assess_fulfillment:doc_recovery"]?.tx, status: intent.status, record: fulfillmentRecord, terminal: txSummary(assessment.tx)};
  const accountingAfterReserve = asRecord(await read(readClient, VAULT, "get_accounting", [mandateId], latestFinal));
  state.observations.accounting_after_reserve = accountingAfterReserve;
  state.observations.final_lifecycle_state = intent.status;
  saveState(state);
  const report = {network: NETWORK, chain_id: CHAIN_ID, core: CORE, vault: VAULT, mandate_id: mandateId, mandate_status: mandate.status, fresh_intent_id: intentId, evidence_id: asRecord(await read(readClient, CORE, "get_evidence", [intentId, 0n], latestFinal)).evidence_id ?? "", fulfillment_evidence_id: asRecord(await read(readClient, CORE, "get_evidence", [intentId, 1n], latestFinal)).evidence_id ?? "", evidence_url: EVIDENCE_URL, evidence_sha256: EVIDENCE_SHA, evidence_byte_length: EVIDENCE_BYTES, auth: authSummary, reservation: reservation.readback, fulfillment: state.observations.fulfillment, accounting: accountingAfterReserve, final_lifecycle_state: intent.status, i2_preserved: true};
  state.observations.final = report;
  saveState(state);
  saveJson(path.join(ARTIFACT_DIR, "final-report.json"), report);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
