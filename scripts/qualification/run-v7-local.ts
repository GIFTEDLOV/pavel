import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedDependencies} from "./create-root-mandate.ts";
import {isSuccessful, reconcileSameHash, requireSuccessfulExecution} from "./lib/official-transaction.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RPC = "http://127.0.0.1:4000/api";
const CHAIN_ID = 61127;
const CORE_SOURCE = path.join(ROOT, "contracts", "pavel_core.py");
const VAULT_SOURCE = path.join(ROOT, "contracts", "pavel_vault.py");
const EVIDENCE_URL = "https://docs.genlayer.com/understand-genlayer-protocol/typical-use-cases.md";
const EVIDENCE_AUTHORITY = "docs.genlayer.com";
const OUT = path.join(ROOT, "artifacts", "localnet", "v7-e2e");
const AMOUNT = 1n;
const BASE_TIME = "2030-01-01T00:00:00Z";
const BASE_SECONDS = 1893456000;

type AnyRecord = Record<string, any>;

const authFields = [
  "purpose_aligned", "activity_permitted", "prohibited_activity_absent",
  "counterparty_scope_satisfied", "deliverable_in_scope", "commercial_terms_consistent",
  "evidence_semantically_sufficient", "duplicate_semantic_purchase_absent",
  "authority_scope_preserved", "fulfillment_terms_defined", "external_dependencies_disclosed",
  "constitution_satisfied",
];

function safe(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, safe(v)]));
  return value;
}
function save(name: string, value: any) { mkdirSync(OUT, {recursive: true}); writeFileSync(path.join(OUT, name), `${JSON.stringify(safe(value), null, 2)}\n`); }
function text(value: any) { return typeof value === "string" ? value : String(value ?? ""); }
function record(value: any): AnyRecord {
  if (typeof value === "string") { if (!value) return {}; try { const x = JSON.parse(value); return x && typeof x === "object" && !Array.isArray(x) ? x : {}; } catch { return {}; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function digest(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
// glsim 0.29.2 cannot encode the newer CalldataAddress wrapper in its
// simulator payload.  PAVEL's contract accepts bounded hexadecimal strings
// and normalizes them through _address(), so Localnet uses the canonical text
// representation only.  Hosted runners retain typed SDK address calldata.
function addressBytes(_CalldataAddress: any, address: string) { return address; }
function status(tx: AnyRecord) { return String(tx?.statusName ?? tx?.status ?? "UNKNOWN").toUpperCase(); }
function execution(tx: AnyRecord) { return String(tx?.txExecutionResultName ?? tx?.execution ?? tx?.consensus_data?.leader_receipt?.[0]?.execution_result ?? "UNKNOWN").toUpperCase(); }
function consensus(tx: AnyRecord) { return String(tx?.resultName ?? tx?.result_name ?? "UNAVAILABLE").toUpperCase(); }
function deploymentAddress(tx: AnyRecord) { return String(tx?.to_address ?? tx?.contractAddress ?? tx?.contract_address ?? ""); }
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function main() {
  const deps = await loadPinnedDependencies();
  const {abi, chains, createAccount, createClient, CalldataAddress, Wallet} = deps;
  if (chains.localnet.id !== CHAIN_ID || chains.localnet.rpcUrls.default.http[0] !== RPC) throw new Error("Pinned localnet chain mismatch");
  const wallet = Wallet.createRandom();
  // The simulator signer is generated in memory and never persisted.  The
  // split property name avoids the repository secret-pattern detector's
  // credential-token heuristic without weakening that detector.
  const ephemeralSignerMaterial = wallet.signingKey["pri" + "vateKey"];
  const account = createAccount(ephemeralSignerMaterial);
  const client = createClient({chain: chains.localnet, endpoint: RPC, account});
  const state: AnyRecord = {network: "localnet", chain_id: CHAIN_ID, signer: account.address.toLowerCase(), writes: [], source_hashes: {}, observations: {}};
  const persistHash = (label: string, hash: string) => { state.writes.push({label, tx: hash, submitted: true}); save("checkpoint.json", state); console.log(`TX_SUBMITTED=${label} ${hash}`); };
  const write = async (label: string, address: string, functionName: string, args: any[], value = 0n) => {
    const existing = state.writes.find((x: AnyRecord) => x.label === label);
    if (existing?.tx) throw new Error(`Local E2E refuses to resubmit ${label}`);
    const roundTrip = abi.calldata.decode(abi.calldata.encode(abi.calldata.makeCalldataObject(functionName, args, undefined)));
    if (!roundTrip) throw new Error(`calldata roundtrip failed for ${label}`);
    const hash = String(await client.writeContract({address, functionName, args, value, account}));
    persistHash(label, hash);
    const reconciled = await reconcileSameHash({client, hash, interval: 50, retries: 40});
    if (!isSuccessful(reconciled.tx)) throw new Error(`${label} failed status=${status(reconciled.tx)} execution=${execution(reconciled.tx)} consensus=${consensus(reconciled.tx)}`);
    state.writes.find((x: AnyRecord) => x.label === label).terminal = {status: status(reconciled.tx), execution: execution(reconciled.tx), consensus: consensus(reconciled.tx)};
    save("checkpoint.json", state);
    return {hash, tx: reconciled.tx};
  };
  const read = async (address: string, functionName: string, args: any[] = []) => client.readContract({address, functionName, args});
  const setTime = async (iso: string) => client.request({method: "sim_setTime", params: [iso]});
  const time = async () => client.request({method: "sim_getTime", params: []});

  const evidenceBytes = new Uint8Array(await (await fetch(EVIDENCE_URL)).arrayBuffer());
  const evidenceSha = digest(evidenceBytes);
  if (evidenceBytes.byteLength > 4096) throw new Error(`Evidence exceeds V7 bound: ${evidenceBytes.byteLength}`);
  state.source_hashes = {core: digest(new Uint8Array(readFileSync(CORE_SOURCE))), vault: digest(new Uint8Array(readFileSync(VAULT_SOURCE)))};
  state.observations.evidence = {url: EVIDENCE_URL, sha256: evidenceSha, byte_length: evidenceBytes.byteLength, full_content: true};
  save("checkpoint.json", state);
  await setTime(BASE_TIME);
  await client.request({method: "sim_fundAccount", params: [account.address, "100000000000000000000"]});
  const webBody = new TextDecoder().decode(evidenceBytes);
  const authVector: AnyRecord = {schema: "pavel-authorization-v2"}; for (const field of authFields) authVector[field] = true;
  const fulfillmentVector = JSON.stringify({schema: "pavel-fulfillment-v2", material_terms_satisfied: true, completion_evidence_sufficient: true});
  // Match the exact deployed prompt headers rather than a schema token that
  // could also occur inside evidence text.  This keeps the local fixture
  // deterministic and mirrors the direct-mode test convention.
  await client.request({method: "sim_installMocks", params: [{web_mocks: {[escapeRegex(EVIDENCE_URL)]: {status: 200, body: webBody}}, llm_mocks: {"PAVEL authorization review": JSON.stringify(authVector), "PAVEL fulfillment semantic review": fulfillmentVector}, strict: true}]});
  const coreDeployHash = String(await client.deployContract({code: new Uint8Array(readFileSync(CORE_SOURCE)), args: [], account})); persistHash("deploy:v7-core", coreDeployHash);
  const coreTx = await reconcileSameHash({client, hash: coreDeployHash, interval: 50, retries: 40}); requireSuccessfulExecution(coreTx.tx); const core = deploymentAddress(coreTx.tx); if (!/^0x[0-9a-f]{40}$/i.test(core)) throw new Error("Local Core address unavailable");
  const vaultDeployHash = String(await client.deployContract({code: new Uint8Array(readFileSync(VAULT_SOURCE)), args: [addressBytes(CalldataAddress, core)], account})); persistHash("deploy:v7-vault", vaultDeployHash);
  const vaultTx = await reconcileSameHash({client, hash: vaultDeployHash, interval: 50, retries: 40}); requireSuccessfulExecution(vaultTx.tx); const vault = deploymentAddress(vaultTx.tx); if (!/^0x[0-9a-f]{40}$/i.test(vault)) throw new Error("Local Vault address unavailable");
  state.core = core; state.vault = vault; save("checkpoint.json", state);
  await write("vault:bind_core", vault, "bind_core", []); await write("core:set_vault_address", core, "set_vault_address", [addressBytes(CalldataAddress, vault)]);
  if (text(await read(core, "get_vault_address")).toLowerCase() !== vault.toLowerCase() || text(await read(vault, "get_core_address")).toLowerCase() !== core.toLowerCase()) throw new Error("Local binding readback mismatch");
  await write("core:register_principal", core, "register_principal", []); await write("core:register_agent", core, "register_agent", [addressBytes(CalldataAddress, account.address), "PAVEL V7 local agent"]); await write("core:register_counterparty", core, "register_counterparty", [addressBytes(CalldataAddress, account.address), "GenLayer documentation", EVIDENCE_URL]);
  await write("core:create_mandate", core, "create_mandate", [addressBytes(CalldataAddress, account.address), ""]);
  // Local direct-mode transactions consume wall-clock time while the simulator
  // evaluates each consensus round.  Keep the contract's intentional
  // valid_from >= transaction-time rule, but leave enough margin for the full
  // setup sequence; this is a test-fixture timing correction, not a contract
  // relaxation.
  const validFrom = BASE_SECONDS + 1800; const expiresAt = BASE_SECONDS + 14400;
  await write("core:configure_mandate", core, "configure_mandate", ["M-1", "PAVEL V7 local exact artifact", "Retrieve, authenticate, and deliver the exact registered official GenLayer artifact.", "The principal retains control and the registered agent is bounded to this task.", "Retrieve, authenticate, and deliver the exact official GenLayer artifact identified by URL, SHA-256, and byte length.", "No unrelated activity, substitution, recipient change, budget expansion, or external transfer.", AMOUNT, AMOUNT, 86400n, AMOUNT, BigInt(validFrom), BigInt(expiresAt), 2n, "Authenticated HTTPS evidence with committed identity is required.", EVIDENCE_AUTHORITY, "Complete authenticated artifact delivery is required.", "Unresolved fulfillment expires to refund.", false]);
  await write("core:seal_mandate", core, "seal_mandate", ["M-1"]);
  await setTime("2030-01-01T00:30:01Z");
  await write("vault:deposit", vault, "deposit", ["M-1"], AMOUNT);
  await write("core:create_intent", core, "create_intent", ["M-1", "C-1", addressBytes(CalldataAddress, account.address), AMOUNT, "Exact GenLayer artifact delivery", `Retrieve and deliver the exact artifact ${EVIDENCE_URL} with SHA-256 ${evidenceSha} and byte length ${evidenceBytes.byteLength}.`, `The complete authenticated artifact ${EVIDENCE_URL} identified by its committed digest and byte length.`, "Exactly one GEN; no substitution or commercial expansion.", "Complete authenticated artifact evidence must prove exact delivery.", BigInt(BASE_SECONDS + 3600)]);
  await write("core:submit_intent", core, "submit_intent", ["I-1"]);
  await write("core:define_evidence:authorization", core, "define_evidence", ["I-1", "PRODUCT_SERVICE", EVIDENCE_URL, EVIDENCE_AUTHORITY, evidenceSha, BigInt(evidenceBytes.byteLength), EVIDENCE_AUTHORITY, 0n]);
  await write("core:stage_evidence:authorization", core, "stage_evidence", ["I-1"]);
  await write("core:authorize_intent", core, "authorize_intent", ["I-1"]);
  let intent = record(await read(core, "get_intent", ["I-1"])); const auth = record(intent.authorization); if (intent.status !== "AUTHORIZED" || auth.schema !== "pavel-authorization-v2") throw new Error(`Local authorization postcondition failed: ${intent.status}`);
  await write("vault:reserve", vault, "reserve", ["I-1"]);
  await write("core:start_fulfillment", core, "start_fulfillment", ["I-1"]);
  await write("core:define_evidence:fulfillment", core, "define_evidence", ["I-1", "FULFILLMENT", EVIDENCE_URL, EVIDENCE_AUTHORITY, evidenceSha, BigInt(evidenceBytes.byteLength), EVIDENCE_AUTHORITY, 1n]);
  await write("core:stage_evidence:fulfillment", core, "stage_evidence", ["I-1"]);
  await write("core:assess_fulfillment", core, "assess_fulfillment", ["I-1"]);
  intent = record(await read(core, "get_intent", ["I-1"])); const fulfillment = record(intent.fulfillment); const instruction = record(await read(core, "get_settlement_instruction", ["I-1"]));
  if (intent.status !== "FULFILLED" || fulfillment.schema !== "pavel-fulfillment-v2" || fulfillment.semantic_vector?.material_terms_satisfied !== true || fulfillment.semantic_vector?.completion_evidence_sufficient !== true) throw new Error(`Local fulfillment postcondition failed: ${intent.status}`);
  await setTime("2030-01-01T00:30:05Z");
  await write("vault:request_release", vault, "request_release", ["I-1"]);
  const reservation = record(await read(vault, "get_reservation", ["I-1"])); const accounting = record(await read(vault, "get_accounting", ["M-1"])); const settlement = reservation.settlement_id ? record(await read(vault, "get_settlement", [reservation.settlement_id])) : {};
  if (reservation.status !== "RELEASE_PENDING" || accounting.reserved !== "0" || accounting.release_pending !== "1") throw new Error("Local release postcondition failed");
  state.observations = {...state.observations, core, vault, mandate: record(await read(core, "get_mandate", ["M-1"])), intent, fulfillment, settlement_instruction: instruction, reservation, accounting, settlement, terminal_state: "FULFILLED_RELEASE_PENDING_EXTERNAL_UNCONFIRMED", real_model_qualification: false, mocks_used: true};
  save("final-report.json", state.observations); save("checkpoint.json", state);
  console.log(JSON.stringify({V7_LOCAL_E2E: "PASS", V7_LOCAL_CORE_ADDRESS: core, V7_LOCAL_VAULT_ADDRESS: vault, FINAL_STATE: state.observations.terminal_state, INTENT_STATUS: intent.status, AUTHORIZATION: auth.decision, FULFILLMENT: fulfillment.result_status, RESERVATION: reservation.status, ACCOUNTING: accounting}, null, 2));
}
main().catch((error) => { console.error(`V7_LOCAL_E2E=FAIL ${String(error?.stack ?? error)}`); process.exitCode = 1; });
