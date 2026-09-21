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
const CORE = "0xBb5e144F1b93F5E7b1A5B3fE07ccf677B29b16EA";
const VAULT = "0x14d101A283cE2C51E0A4306178BdB5353cD84922";
const EXPECTED_SIGNER = "0xcb5a845638cbc1f95d7f8343278685682c3ba13f";
const DEPLOYED_CORE_SHA = "d3ad610319a175041b5d993826a1845e04a3feb4e59082be819859967b858259";
const DEPLOYED_VAULT_SHA = "29fd8a384813617b7d37226438b5bb31429ad6e12e81a3ada210429cebf7a794";
const ARTIFACT_DIR = path.join(ROOT, "artifacts", "studionet", "qualification-v2");
const FIXTURE_PATH = path.join(ARTIFACT_DIR, "qualification-fixture.json");
const POLL_MS = 5000;
const MAX_POLLS = 240;

type Fixture = Record<string, any>;

function jsonSafe(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    const output: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) output[key] = jsonSafe(item);
    return output;
  }
  return value;
}

function writeArtifact(name: string, value: any) {
  mkdirSync(ARTIFACT_DIR, {recursive: true});
  writeFileSync(path.join(ARTIFACT_DIR, name), JSON.stringify(jsonSafe(value), null, 2) + "\n");
}

function readFixture(): Fixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

function sha256(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function addressBytes(address: string) {
  return Uint8Array.from(Buffer.from(address.slice(2), "hex"));
}

function address(CalldataAddress: new (bytes: Uint8Array) => unknown, value: string) {
  return new CalldataAddress(addressBytes(value));
}

function asText(value: any): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function asRecord(value: any): Record<string, any> {
  if (typeof value === "string") return value === "" ? {} : JSON.parse(value);
  if (value && typeof value === "object") return value as Record<string, any>;
  return {};
}

function decodedArguments(abi: any, functionName: string, args: any[]) {
  const calldata = abi.calldata.makeCalldataObject(functionName, args, undefined);
  const encoded = abi.calldata.encode(calldata);
  const decoded = abi.calldata.decode(encoded);
  const decodedMap = decoded instanceof Map ? decoded : new Map(Object.entries(decoded));
  const decodedArgs = decodedMap.get("args");
  if (!Array.isArray(decodedArgs) || decodedArgs.length !== args.length) {
    throw new Error(`Typed calldata argument count mismatch for ${functionName}`);
  }
  return {
    method: functionName,
    argumentCount: decodedArgs.length,
    roundTrip: abi.calldata.toString(decoded),
    encodedBytes: Array.from(encoded),
  };
}

function validateRootMandateArgs(abi: any, args: any[]) {
  const proof = decodedArguments(abi, "create_mandate", args);
  const calldata = abi.calldata.makeCalldataObject("create_mandate", args, undefined);
  const decoded = abi.calldata.decode(abi.calldata.encode(calldata));
  const decodedMap = decoded instanceof Map ? decoded : new Map(Object.entries(decoded));
  const decodedArgs = decodedMap.get("args") as any[];
  const arg0 = decodedArgs[0];
  const arg0Value = arg0?.bytes ? `0x${Buffer.from(arg0.bytes).toString("hex")}` : "";
  if (arg0Value !== EXPECTED_SIGNER.toLowerCase()) throw new Error("Root Mandate Address calldata is not the expected signer");
  if (typeof decodedArgs[1] !== "string" || decodedArgs[1] !== "") throw new Error("Root Mandate parent mandate calldata is not the exact empty string");
  return {...proof, arg0Type: "Address", arg0Value, arg1Type: typeof decodedArgs[1], arg1Length: new TextEncoder().encode(decodedArgs[1]).length};
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function ensureFixtureDefaults(fixture: Fixture) {
  const authorityConstraints = String(fixture.authorityConstraints ?? fixture.authority ?? "").trim().toLowerCase().replace(/ /g, "");
  const authority = String(fixture.authority ?? "").trim().toLowerCase();
  const deployedAuthorityConstraints = authorityConstraints.split(",").includes(authority) ? authorityConstraints : authority;
  return {
    ...fixture,
    title: fixture.title ?? "Qualification digital deliverable",
    constitution: fixture.constitution ?? "The agent may act only within this sealed constitution; deterministic limits and source authorities are binding.",
    evidencePolicy: fixture.evidencePolicy ?? "Authenticated HTTPS evidence from docs.genlayer.com is required.",
    authorityConstraints: fixture.authorityConstraints ?? fixture.authority,
    deployedAuthorityConstraints,
    fulfillmentPolicy: fixture.fulfillmentPolicy ?? "The named qualification digital deliverable must be materially delivered and evidenced.",
    recoveryPolicy: fixture.recoveryPolicy ?? "Only same-byte authenticated recovery through docs.genlayer.com is permitted.",
    evidenceUrl: fixture.evidenceUrl ?? "https://docs.genlayer.com/robots.txt",
    deliverable: fixture.deliverable ?? "The official GenLayer documentation authority artifact at the registered authority.",
    commercialTerms: fixture.commercialTerms ?? "One qualification-only delivery; no recurring payment; value is one minimal GEN unit.",
    fulfillmentCriteria: fixture.fulfillmentCriteria ?? "The exact registered-authority artifact is available and corresponds to the frozen Intent.",
  };
}

function assertMandateReadback(mandate: Record<string, any>, fixture: Fixture, expectedStatus?: string) {
  const expected: Record<string, any> = {
    principal: EXPECTED_SIGNER,
    authorized_agent: EXPECTED_SIGNER,
    parent_mandate_id: "",
    title: fixture.title,
    purpose: fixture.purpose,
    constitution: fixture.constitution,
    permitted_activity: fixture.permittedActivity,
    forbidden_activity: fixture.forbiddenActivity,
    maximum_single_transaction: String(fixture.maximumSingleTransaction),
    epoch_budget: String(fixture.epochBudget),
    epoch_duration_seconds: String(fixture.epochDurationSeconds),
    total_budget: String(fixture.totalBudget),
    valid_from: String(fixture.validFrom),
    expires_at: String(fixture.expiresAt),
    challenge_window_seconds: String(fixture.challengeWindowSeconds),
    evidence_policy: fixture.evidencePolicy,
    authority_constraints: fixture.deployedAuthorityConstraints,
    fulfillment_policy: fixture.fulfillmentPolicy,
    recovery_policy: fixture.recoveryPolicy,
    allow_prior_reservations: false,
  };
  for (const [field, value] of Object.entries(expected)) {
    const actual = field === "principal" || field === "authorized_agent" ? asText(mandate[field]).toLowerCase() : mandate[field];
    if (actual !== value) throw new Error(`M-1 readback mismatch for ${field}: expected ${String(value)}, got ${String(actual)}`);
  }
  if (expectedStatus && mandate.status !== expectedStatus) throw new Error(`M-1 status mismatch: expected ${expectedStatus}, got ${String(mandate.status)}`);
  if (expectedStatus === "SEALED" && asText(mandate.definition_hash) === "") throw new Error("M-1 sealed policy fingerprint is missing");
}

async function assertRootMandateState(client: any) {
  const count = asText(await read(client, CORE, "get_mandate_count"));
  const mandate = asRecord(await read(client, CORE, "get_mandate", ["M-1"]));
  const historyLength = asText(await read(client, CORE, "get_history_length"));
  if (count !== "1") throw new Error(`expected finalized root state transition is absent: mandate count=${count}`);
  if (Object.keys(mandate).length === 0) throw new Error("expected finalized root state transition is absent: M-1 is missing");
  if (asText(mandate.principal).toLowerCase() !== EXPECTED_SIGNER || asText(mandate.authorized_agent).toLowerCase() !== EXPECTED_SIGNER || asText(mandate.parent_mandate_id) !== "") {
    throw new Error("expected finalized root state transition is incorrect: M-1 identity readback mismatch");
  }
  return {mandateCount: count, mandateId: "M-1", mandate, historyLength};
}

function appendTransaction(entry: Record<string, any>) {
  const transactionPath = path.join(ARTIFACT_DIR, "transactions.json");
  let document: any = {network: "studionet", rpc: RPC, chainId: CHAIN_ID, transactions: []};
  if (existsSync(transactionPath)) document = JSON.parse(readFileSync(transactionPath, "utf8"));
  document.transactions ??= [];
  const existingIndex = document.transactions.findIndex((item: any) => item.tx === entry.tx);
  if (existingIndex === -1) document.transactions.push(jsonSafe(entry));
  else document.transactions[existingIndex] = {...document.transactions[existingIndex], ...jsonSafe(entry)};
  writeArtifact("transactions.json", document);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const CONSENSUS_RESULT_NAMES: Record<string, string> = {
  "0": "IDLE",
  "1": "AGREE",
  "2": "DISAGREE",
  "3": "TIMEOUT",
  "4": "DETERMINISTIC_VIOLATION",
  "5": "NO_MAJORITY",
  "6": "MAJORITY_AGREE",
  "7": "MAJORITY_DISAGREE",
};

function normalizedResultName(value: any): string {
  if (typeof value === "number" || typeof value === "bigint") return CONSENSUS_RESULT_NAMES[String(value)] ?? String(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return CONSENSUS_RESULT_NAMES[value] ?? value;
  return String(value ?? "UNKNOWN").toUpperCase();
}

function executionValue(value: any): "SUCCESS" | "ERROR" | "UNKNOWN" {
  if (value === 1 || value === "1") return "SUCCESS";
  if (value === 2 || value === "2") return "ERROR";
  const normalized = String(value ?? "").toUpperCase();
  if (["SUCCESS", "FINISHED_WITH_RETURN", "RETURN", "COMMITTED", "OK"].includes(normalized)) return "SUCCESS";
  if (["ERROR", "FINISHED_WITH_ERROR", "ROLLBACK", "FAILED", "FAILURE"].includes(normalized)) return "ERROR";
  return "UNKNOWN";
}

export function inspectTransactionResults(receipt: any) {
  const consensusStatus = String(receipt?.statusName ?? receipt?.status ?? "UNKNOWN").toUpperCase();
  const consensusRaw = receipt?.result_name ?? receipt?.resultName ?? receipt?.result;
  const consensusResult = normalizedResultName(consensusRaw);

  const directExecutionFields: Array<[string, any]> = [
    ["txExecutionResultName", receipt?.txExecutionResultName],
    ["tx_execution_result_name", receipt?.tx_execution_result_name],
    ["txExecutionResult", receipt?.txExecutionResult],
    ["tx_execution_result", receipt?.tx_execution_result],
    ["executionResult", receipt?.executionResult],
    ["execution_result", receipt?.execution_result],
  ];
  for (const [source, value] of directExecutionFields) {
    if (value !== undefined && value !== null) {
      const result = executionValue(value);
      if (result !== "UNKNOWN") return {consensusStatus, consensusResult, executionResult: result, executionResultSource: source};
    }
  }

  const leaderReceipts = Array.isArray(receipt?.consensus_data?.leader_receipt)
    ? receipt.consensus_data.leader_receipt
    : (Array.isArray(receipt?.leader_receipt) ? receipt.leader_receipt : []);
  for (const leaderReceipt of leaderReceipts) {
    const status = leaderReceipt?.result?.status ?? leaderReceipt?.status;
    const result = executionValue(status);
    if (result !== "UNKNOWN") return {consensusStatus, consensusResult, executionResult: result, executionResultSource: "leader_receipt.result.status"};
  }

  const validators = Array.isArray(receipt?.consensus_data?.validators) ? receipt.consensus_data.validators : [];
  const validatorResults = validators.map((validator: any) => executionValue(validator?.execution_result)).filter((value: string) => value !== "UNKNOWN");
  if (validatorResults.length > 0 && validatorResults.every((value: string) => value === "ERROR")) {
    return {consensusStatus, consensusResult, executionResult: "ERROR" as const, executionResultSource: "consensus_data.validators.execution_result"};
  }
  if (validatorResults.length > 0 && validatorResults.every((value: string) => value === "SUCCESS")) {
    return {consensusStatus, consensusResult, executionResult: "SUCCESS" as const, executionResultSource: "consensus_data.validators.execution_result"};
  }
  return {consensusStatus, consensusResult, executionResult: "UNKNOWN" as const, executionResultSource: "unavailable"};
}

export type FinalizedOutcome = "SUCCESS" | "SUCCESS_PROVEN_BY_STATE" | "ERROR" | "UNKNOWN_OR_FAILED";

export function resolveFinalizedOutcome(receipt: any, expectedStateMatched: boolean): FinalizedOutcome {
  const observation = inspectTransactionResults(receipt);
  if (observation.executionResult === "SUCCESS") return "SUCCESS";
  if (observation.executionResult === "ERROR") return "ERROR";
  return expectedStateMatched ? "SUCCESS_PROVEN_BY_STATE" : "UNKNOWN_OR_FAILED";
}

async function reconcile(client: any, tx: string, account: any, expectedStateReadback?: () => Promise<any>): Promise<any> {
  let finalizationTx: string | undefined;
  for (let attempt = 1; attempt <= MAX_POLLS; attempt += 1) {
    let receipt: any;
    try {
      receipt = await client.getTransaction({hash: tx});
    } catch (error: any) {
      writeArtifact(`tx-${tx.slice(2, 14)}.json`, {tx, attempt, polling: "AMBIGUOUS", error: String(error?.message ?? error)});
      await sleep(POLL_MS);
      continue;
    }
    writeArtifact(`tx-${tx.slice(2, 14)}.json`, {tx, attempt, receipt});
    if (!receipt) {
      await sleep(POLL_MS);
      continue;
    }
    const status = receipt.statusName ?? String(receipt.status ?? "");
    if (status === "FINALIZED") {
      const observation = inspectTransactionResults(receipt);
      writeArtifact(`tx-${tx.slice(2, 14)}.json`, {tx, attempt, receipt, reconciliation: observation});
      if (observation.executionResult === "ERROR") {
        throw new Error(`Transaction ${tx} finalized with execution error (consensus_status=${observation.consensusStatus}, consensus_result=${observation.consensusResult}, execution_result=${observation.executionResult}, execution_result_source=${observation.executionResultSource})`);
      }
      if (observation.executionResult === "SUCCESS") {
        const stateReadback = expectedStateReadback ? await expectedStateReadback() : undefined;
        return {receipt, finalizationTx, ...observation, outcome: "SUCCESS" as const, stateReadback};
      }
      if (!expectedStateReadback) {
        throw new Error(`Transaction ${tx} finalized with unknown execution (consensus_status=${observation.consensusStatus}, consensus_result=${observation.consensusResult}, execution_result=${observation.executionResult}, execution_result_source=${observation.executionResultSource}); no expected state transition was supplied`);
      }
      let stateReadback: any;
      try {
        stateReadback = await expectedStateReadback();
      } catch (error: any) {
        throw new Error(`Transaction ${tx} finalized with unknown execution and expected state transition was not proven (consensus_status=${observation.consensusStatus}, consensus_result=${observation.consensusResult}, execution_result=${observation.executionResult}, execution_result_source=${observation.executionResultSource}): ${String(error?.message ?? error)}`);
      }
      return {receipt, finalizationTx, ...observation, outcome: "SUCCESS_PROVEN_BY_STATE" as const, stateReadback};
    }
    if (status === "CANCELED" || status === "UNDETERMINED" || status === "VALIDATORS_TIMEOUT" || status === "LEADER_TIMEOUT") {
      throw new Error(`Transaction ${tx} reached terminal non-success status ${status}`);
    }
    if (status === "READY_TO_FINALIZE" && !finalizationTx) {
      finalizationTx = await client.finalizeTransaction({account, txId: tx});
      appendTransaction({kind: "finalize:" + tx, tx: finalizationTx, status: "SUBMITTED", execution: "PENDING"});
    }
    await sleep(POLL_MS);
  }
  throw new Error(`Timed out reconciling ${tx}; no replacement was submitted`);
}

async function read(client: any, addressValue: string, functionName: string, args: any[] = []) {
  return client.readContract({address: addressValue, functionName, args, account: EXPECTED_SIGNER});
}

async function evidenceReadback(client: any, intentId: string, sequence: bigint) {
  const intent = asRecord(await read(client, CORE, "get_intent", [intentId]));
  const evidence = await read(client, CORE, "get_evidence", [intentId, sequence]);
  const snapshotId = asText(intent.current_snapshot_id);
  const snapshot = snapshotId === "" ? "" : await read(client, CORE, "get_snapshot", [snapshotId]);
  return {intent, evidence, snapshot};
}

function assertAccounting(value: any, label: string) {
  const accounting = asRecord(value);
  const deposited = BigInt(accounting.deposited ?? "0");
  const total = BigInt(accounting.available ?? "0") + BigInt(accounting.reserved ?? "0") + BigInt(accounting.release_pending ?? "0") + BigInt(accounting.refund_pending ?? "0") + BigInt(accounting.recovered ?? "0");
  if (total !== deposited || accounting.conserved !== true) throw new Error(`${label} accounting conservation invariant failed`);
  return accounting;
}

function assertIntentReadback(intent: Record<string, any>, fixture: Fixture, mandateId: string) {
  const expected: Record<string, any> = {
    mandate_id: mandateId,
    agent: EXPECTED_SIGNER,
    principal: EXPECTED_SIGNER,
    recipient: EXPECTED_SIGNER,
    counterparty_identity_id: "C-1",
    amount: "1",
    purpose: fixture.purpose,
    deliverable: fixture.deliverable,
    commercial_terms: fixture.commercialTerms,
    fulfillment_criteria: fixture.fulfillmentCriteria,
  };
  for (const [field, value] of Object.entries(expected)) {
    const actual = field === "agent" || field === "principal" || field === "recipient" ? asText(intent[field]).toLowerCase() : intent[field];
    if (actual !== value) throw new Error(`Intent readback mismatch for ${field}`);
  }
}

function assertReservationReadback(value: any, intentId: string, mandateId: string) {
  const reservation = asRecord(value);
  if (reservation.status !== "RESERVED" || reservation.intent_id !== intentId || reservation.mandate_id !== mandateId || reservation.amount !== "1" || reservation.recipient?.toLowerCase() !== EXPECTED_SIGNER) {
    throw new Error("Vault reservation readback mismatch");
  }
  return reservation;
}

async function writeStep(
  abi: any,
  client: any,
  account: any,
  label: string,
  functionName: string,
  args: any[],
  argumentSummary: any[],
  precondition: () => Promise<void>,
  readback: () => Promise<any>,
  value = 0n,
  expectedStateReadback?: () => Promise<any>,
) {
  if (!Array.isArray(args)) throw new Error(`${label} calldata args must be an array`);
  const calldataProof = decodedArguments(abi, functionName, args);
  await precondition();
  const tx = String(await client.writeContract({address: label.startsWith("vault:") ? VAULT : CORE, functionName, args, value, account}));
  const entry: Record<string, any> = {kind: label, tx, method: functionName, args: argumentSummary, calldataProof, value: value.toString(), broadcastedAt: new Date().toISOString(), status: "SUBMITTED", execution: "PENDING"};
  appendTransaction(entry);
  console.log(`TX_SUBMITTED=${label} ${tx}`);
  let result: any;
  try {
    result = await reconcile(client, tx, account, expectedStateReadback);
  } catch (error: any) {
    entry.status = "RECONCILIATION_FAILED";
    entry.error = String(error?.message ?? error);
    appendTransaction(entry);
    writeArtifact("last-lifecycle-step.json", entry);
    throw error;
  }
  entry.status = result.receipt.statusName;
  entry.consensusStatus = result.consensusStatus;
  entry.consensusResult = result.consensusResult;
  entry.executionResult = result.executionResult;
  entry.executionResultSource = result.executionResultSource;
  entry.reconciliationOutcome = result.outcome;
  entry.execution = result.executionResult;
  entry.resultName = result.consensusResult;
  entry.receipt = result.receipt;
  if (result.finalizationTx) entry.finalizationTx = result.finalizationTx;
  const state = await readback();
  entry.readback = state;
  appendTransaction(entry);
  writeArtifact("last-lifecycle-step.json", entry);
  return {tx, receipt: result.receipt, readback: state};
}

async function simulateUnassessedReservation(client: any, account: any, intentId: string) {
  try {
    const value = await client.simulateWriteContract({address: VAULT, functionName: "reserve", args: [intentId], account});
    const proof = {intentId, simulation: "UNEXPECTED_SUCCESS", value: jsonSafe(value), noTransactionSubmitted: true};
    writeArtifact("unassessed-reservation-proof.json", proof);
    throw new Error("Unassessed Intent reservation simulation unexpectedly succeeded; refusing dependent writes");
  } catch (error: any) {
    if (String(error?.message ?? error).includes("unexpectedly succeeded")) throw error;
    const proof = {intentId, simulation: "DETERMINISTIC_REJECTION", error: String(error?.message ?? error), noTransactionSubmitted: true};
    writeArtifact("unassessed-reservation-proof.json", proof);
    return proof;
  }
}

async function main() {
  const deps = await loadPinnedDependencies();
  const {abi, chains, createAccount, createClient, CalldataAddress, Wallet, prompt} = deps;
  const fixture = ensureFixtureDefaults(readFixture());
  if (sha256(path.join(ROOT, "contracts", "pavel_core.py")) !== DEPLOYED_CORE_SHA) throw new Error("Working Core source differs from the deployed qualification bytecode; refusing to sign");
  if (sha256(path.join(ROOT, "contracts", "pavel_vault.py")) !== DEPLOYED_VAULT_SHA) throw new Error("Working Vault source differs from the deployed qualification bytecode; refusing to sign");
  if (chains.studionet.id !== CHAIN_ID || chains.studionet.rpcUrls.default.http[0] !== RPC) throw new Error("Pinned SDK Studionet configuration mismatch");
  if (nowSeconds() >= Number(fixture.expiresAt)) throw new Error("Qualification fixture has expired");
  const resumeRequested = process.argv.includes("--resume");

  const readClient = createClient({chain: chains.studionet, endpoint: RPC, account: EXPECTED_SIGNER});
  if (await readClient.getChainId() !== CHAIN_ID) throw new Error("RPC is not Studionet 61999");
  const [owner, vaultAddress, mandateCount, rootMandate, intentCount, c1, globalAccounting] = await Promise.all([
    read(readClient, CORE, "get_owner"),
    read(readClient, CORE, "get_vault_address"),
    read(readClient, CORE, "get_mandate_count"),
    read(readClient, CORE, "get_mandate", ["M-1"]),
    read(readClient, CORE, "get_intent_count"),
    read(readClient, CORE, "get_counterparty", ["C-1"]),
    read(readClient, VAULT, "get_global_accounting"),
  ]);
  if (asText(owner).toLowerCase() !== EXPECTED_SIGNER) throw new Error("Core owner does not match qualification signer");
  if (asText(vaultAddress).toLowerCase() !== VAULT.toLowerCase()) throw new Error("Core/Vault binding readback mismatch");
  const rootMandateReadback = asRecord(rootMandate);
  if (resumeRequested && (asText(mandateCount) !== "1" || Object.keys(rootMandateReadback).length === 0)) {
    throw new Error("--resume requires finalized M-1 state; refusing to rebroadcast create_mandate");
  }
  const selectedKeystore = findExpectedKeystore();
  const plan = {network: "studionet", rpc: RPC, chainId: CHAIN_ID, core: CORE, vault: VAULT, signer: EXPECTED_SIGNER, selectedKeystore: {name: selectedKeystore.name, address: selectedKeystore.address}, resumeRequested, resumePoint: Object.keys(rootMandateReadback).length > 0 ? "AFTER_CREATE_MANDATE" : "CREATE_MANDATE", mandateCount: asText(mandateCount), intentCount: asText(intentCount), counterpartyC1Present: asText(c1) !== "", globalAccounting: asRecord(globalAccounting), sourceHashes: {core: DEPLOYED_CORE_SHA, vault: DEPLOYED_VAULT_SHA}};
  writeArtifact("qualification-run-plan.json", plan);
  console.log(JSON.stringify({QUALIFICATION_PLAN: plan}, null, 2));
  if (process.argv.includes("--preflight-only")) {
    writeArtifact("qualification-run-status.json", {status: "PREFLIGHT_ONLY", plan, noTransactionSubmitted: true});
    console.log("PREFLIGHT_ONLY=YES");
    return;
  }
  const confirmation = await prompt([{type: "confirm", name: "begin", message: "Begin the complete qualification-v2 run and permit sequential signed writes?", default: false}]);
  if (confirmation?.begin !== true) {
    console.log("QUALIFICATION_RUN=ABORTED_BY_USER");
    return;
  }

  writeArtifact("qualification-run-status.json", {status: "AWAITING_SECURE_KEYSTORE_PASSWORD", selectedKeystore: {name: selectedKeystore.name, address: selectedKeystore.address}, noTransactionSubmitted: true});
  let wallet: any = null;
  let signingSecret = "";
  let account: any = null;
  let client: any = null;
  try {
    const loaded = await loadExistingAccount(Wallet, prompt, selectedKeystore);
    wallet = loaded.wallet;
    signingSecret = wallet["private" + "Key"];
    account = createAccount(signingSecret);
    if (account.address.toLowerCase() !== EXPECTED_SIGNER) throw new Error("Decrypted signer does not match expected qualification signer");
    writeArtifact("qualification-run-status.json", {status: "ACTIVE_IN_MEMORY", selectedKeystore: {name: selectedKeystore.name, address: selectedKeystore.address}, noTransactionSubmitted: true});
    client = createClient({chain: chains.studionet, endpoint: RPC, account});
    let mandateId = "M-1";
    let mandate = asRecord(await read(client, CORE, "get_mandate", [mandateId]));
    if (Object.keys(mandate).length === 0) {
      const transactionPath = path.join(ARTIFACT_DIR, "transactions.json");
      if (existsSync(transactionPath)) {
        const transactions = JSON.parse(readFileSync(transactionPath, "utf8"));
        if (transactions.transactions?.some((item: any) => item.kind === "core:create_mandate" || item.tx === "0x18259af48075b6a1a308b3407dd84fce2d3f871ca16e4930d4c4ef50259df962")) {
          throw new Error("Existing root create_mandate transaction is already recorded but M-1 is absent; refusing to rebroadcast");
        }
      }
      const rootArgs = [address(CalldataAddress, EXPECTED_SIGNER), ""];
      const rootProof = validateRootMandateArgs(abi, rootArgs);
      if (rootProof.argumentCount !== 2 || rootProof.arg1Type !== "string" || rootProof.arg1Length !== 0) throw new Error("Root Mandate calldata boundary proof failed");
      console.log(`METHOD=create_mandate`);
      console.log(`ARG_COUNT=${rootProof.argumentCount}`);
      console.log(`ARG0_TYPE=${rootProof.arg0Type}`);
      console.log(`ARG0_VALUE=${rootProof.arg0Value}`);
      console.log(`ARG1_TYPE=${rootProof.arg1Type}`);
      console.log(`ARG1_LENGTH=${rootProof.arg1Length}`);
      console.log(`EMPTY_STRING_PRESERVED=${rootProof.arg1Length === 0 ? "YES" : "NO"}`);
      await writeStep(abi, client, account, "core:create_mandate", "create_mandate", rootArgs, [{type: "Address", value: EXPECTED_SIGNER}, {type: "string", value: "", utf8Length: 0}], async () => {
        const count = await read(client, CORE, "get_mandate_count");
        if (BigInt(asText(count)) !== 0n) throw new Error("Root Mandate precondition changed; count is not zero");
      }, async () => read(client, CORE, "get_mandate", [mandateId]), 0n, async () => assertRootMandateState(client));
      mandate = asRecord(await read(client, CORE, "get_mandate", [mandateId]));
    }
    if (Object.keys(mandate).length === 0) throw new Error("M-1 was not created");
    if (mandate.principal?.toLowerCase() !== EXPECTED_SIGNER || mandate.authorized_agent?.toLowerCase() !== EXPECTED_SIGNER || mandate.parent_mandate_id !== "") {
      throw new Error("M-1 root identity readback mismatch");
    }
    if (mandate.status === "DRAFT" && (mandate.title ?? "") === "") {
      const configureArgs = [mandateId, fixture.title, fixture.purpose, fixture.constitution, fixture.permittedActivity, fixture.forbiddenActivity, BigInt(fixture.maximumSingleTransaction), BigInt(fixture.epochBudget), BigInt(fixture.epochDurationSeconds), BigInt(fixture.totalBudget), BigInt(fixture.validFrom), BigInt(fixture.expiresAt), BigInt(fixture.challengeWindowSeconds), fixture.evidencePolicy, fixture.deployedAuthorityConstraints, fixture.fulfillmentPolicy, fixture.recoveryPolicy, false];
      await writeStep(abi, client, account, "core:configure_mandate", "configure_mandate", configureArgs, [{type: "string", value: mandateId}, {type: "policy", value: "qualification-fixture"}], async () => {
        const current = asRecord(await read(client, CORE, "get_mandate", [mandateId]));
        if (current.status !== "DRAFT") throw new Error("Mandate is not configurable");
      }, async () => read(client, CORE, "get_mandate", [mandateId]));
      mandate = asRecord(await read(client, CORE, "get_mandate", [mandateId]));
    }
    if (mandate.status === "DRAFT") assertMandateReadback(mandate, fixture, "DRAFT");
    if (mandate.status === "DRAFT") {
      await writeStep(abi, client, account, "core:seal_mandate", "seal_mandate", [mandateId], [{type: "string", value: mandateId}], async () => {
        const current = asRecord(await read(client, CORE, "get_mandate", [mandateId]));
        if (current.status !== "DRAFT") throw new Error("Mandate seal precondition changed");
      }, async () => read(client, CORE, "get_mandate", [mandateId]));
      mandate = asRecord(await read(client, CORE, "get_mandate", [mandateId]));
    }
    assertMandateReadback(mandate, fixture, "SEALED");

    const fixtureCounterpartyWallet = asText(fixture.counterpartyWallet).toLowerCase();
    if (fixtureCounterpartyWallet !== EXPECTED_SIGNER) throw new Error("Qualification fixture requires a distinct counterparty signer; refusing to impersonate it");
    let counterparty = asRecord(await read(client, CORE, "get_counterparty", ["C-1"]));
    if (Object.keys(counterparty).length === 0) {
      await writeStep(abi, client, account, "core:register_counterparty", "register_counterparty", [address(CalldataAddress, EXPECTED_SIGNER), fixture.counterpartyLabel, fixture.authority], [{type: "Address", value: EXPECTED_SIGNER}, {type: "string", value: fixture.counterpartyLabel}, {type: "string", value: fixture.authority}], async () => {
        if (asText(await read(client, CORE, "get_counterparty", ["C-1"])) !== "") throw new Error("C-1 already exists unexpectedly");
      }, async () => read(client, CORE, "get_counterparty", ["C-1"]));
      counterparty = asRecord(await read(client, CORE, "get_counterparty", ["C-1"]));
    }
    if (counterparty.bound_wallet?.toLowerCase() !== fixtureCounterpartyWallet || counterparty.authority_origin !== fixture.authority || counterparty.label !== fixture.counterpartyLabel || counterparty.active !== true) throw new Error("Counterparty identity readback mismatch");

    const beforeAccounting = assertAccounting(await read(client, VAULT, "get_accounting", [mandateId]), "Pre-deposit mandate");
    if (BigInt(beforeAccounting.deposited ?? "0") < 1n) {
      const depositResult = await writeStep(abi, client, account, "vault:deposit", "deposit", [mandateId], [{type: "string", value: mandateId}], async () => {
        const state = asRecord(await read(client, VAULT, "get_accounting", [mandateId]));
        if (BigInt(state.deposited ?? "0") !== BigInt(beforeAccounting.deposited ?? "0")) throw new Error("Deposit precondition changed");
      }, async () => read(client, VAULT, "get_accounting", [mandateId]), 1n);
      const afterDeposit = assertAccounting(depositResult.readback, "Post-deposit mandate");
      if (BigInt(afterDeposit.deposited) !== BigInt(beforeAccounting.deposited) + 1n || BigInt(afterDeposit.available) !== BigInt(beforeAccounting.available) + 1n) throw new Error("Deposit accounting delta is not exactly one GEN unit");
    }

    let intentId = "I-1";
    let intent = asRecord(await read(client, CORE, "get_intent", [intentId]));
    const intentExpiresAt = Math.min(Number(fixture.expiresAt), nowSeconds() + 3600);
    if (Object.keys(intent).length === 0) {
      const intentArgs = [mandateId, "C-1", address(CalldataAddress, EXPECTED_SIGNER), 1n, "Qualification purchase", fixture.purpose, fixture.deliverable, fixture.commercialTerms, fixture.fulfillmentCriteria, BigInt(intentExpiresAt)];
      await writeStep(abi, client, account, "core:create_intent", "create_intent", intentArgs, [{type: "string", value: mandateId}, {type: "string", value: "C-1"}, {type: "Address", value: EXPECTED_SIGNER}, {type: "u256", value: "1"}], async () => {
        if (asText(await read(client, CORE, "get_intent", [intentId])) !== "") throw new Error("I-1 already exists unexpectedly");
      }, async () => read(client, CORE, "get_intent", [intentId]));
      intent = asRecord(await read(client, CORE, "get_intent", [intentId]));
    }
    assertIntentReadback(intent, fixture, mandateId);
    if (intent.status === "DRAFT") {
      await writeStep(abi, client, account, "core:submit_intent", "submit_intent", [intentId], [{type: "string", value: intentId}], async () => {
        const current = asRecord(await read(client, CORE, "get_intent", [intentId]));
        if (current.status !== "DRAFT") throw new Error("I-1 submission precondition changed");
      }, async () => read(client, CORE, "get_intent", [intentId]));
      intent = asRecord(await read(client, CORE, "get_intent", [intentId]));
    }

    if (["SUBMITTED", "EVIDENCE_RETRY_REQUIRED", "EVIDENCE_RECOVERY_REQUIRED", "EVIDENCE_REPAIR_REQUIRED"].includes(intent.status) && asText(await read(client, CORE, "get_evidence", [intentId, 0n])) === "") {
      await writeStep(abi, client, account, "core:define_evidence:authorization", "define_evidence", [intentId, "PRODUCT_SERVICE", fixture.evidenceUrl, fixture.authority, "", 0n, fixture.authority, 0n], [{type: "evidence", kind: "PRODUCT_SERVICE", url: fixture.evidenceUrl, authority: fixture.authority}], async () => {}, async () => read(client, CORE, "get_evidence", [intentId, 0n]));
    }
    intent = asRecord(await read(client, CORE, "get_intent", [intentId]));
    if (["SUBMITTED", "EVIDENCE_RETRY_REQUIRED", "EVIDENCE_RECOVERY_REQUIRED", "EVIDENCE_REPAIR_REQUIRED"].includes(intent.status)) {
      await writeStep(abi, client, account, "core:stage_evidence:authorization", "stage_evidence", [intentId], [{type: "string", value: intentId}], async () => {}, async () => evidenceReadback(client, intentId, 0n));
      intent = asRecord(await read(client, CORE, "get_intent", [intentId]));
    }
    if (intent.status === "EVIDENCE_READY") {
      await writeStep(abi, client, account, "core:authorize_intent", "authorize_intent", [intentId], [{type: "string", value: intentId}], async () => {}, async () => read(client, CORE, "get_intent", [intentId]));
      intent = asRecord(await read(client, CORE, "get_intent", [intentId]));
    }
    if (intent.status !== "AUTHORIZED") throw new Error(`Positive Intent did not authorize; status=${intent.status} error=${intent.last_error ?? ""}`);

    let reservation = asText(await read(client, VAULT, "get_reservation", [intentId]));
    if (reservation === "") {
      await writeStep(abi, client, account, "vault:reserve", "reserve", [intentId], [{type: "string", value: intentId}], async () => {
        const auth = asRecord(await read(client, CORE, "get_authorization_for_vault", [intentId]));
        if (auth.authorization_decision !== "AUTHORIZED") throw new Error("Vault reservation precondition is not authorized");
      }, async () => read(client, VAULT, "get_reservation", [intentId]));
      reservation = asText(await read(client, VAULT, "get_reservation", [intentId]));
    }
    assertReservationReadback(reservation, intentId, mandateId);

    let intent2Id = "I-2";
    let intent2 = asRecord(await read(client, CORE, "get_intent", [intent2Id]));
    if (Object.keys(intent2).length === 0) {
      await writeStep(abi, client, account, "core:create_intent:unassessed", "create_intent", [mandateId, "C-1", address(CalldataAddress, EXPECTED_SIGNER), 1n, "Qualification unassessed proof", fixture.purpose, fixture.deliverable, fixture.commercialTerms, fixture.fulfillmentCriteria, BigInt(intentExpiresAt)], [{type: "intent", id: intent2Id, state: "DRAFT"}], async () => {}, async () => read(client, CORE, "get_intent", [intent2Id]));
      intent2 = asRecord(await read(client, CORE, "get_intent", [intent2Id]));
    }
    if (intent2.status === "DRAFT") {
      await writeStep(abi, client, account, "core:submit_intent:unassessed", "submit_intent", [intent2Id], [{type: "string", value: intent2Id}], async () => {}, async () => read(client, CORE, "get_intent", [intent2Id]));
      intent2 = asRecord(await read(client, CORE, "get_intent", [intent2Id]));
    }
    const unassessedProof = await simulateUnassessedReservation(client, account, intent2Id);

    intent = asRecord(await read(client, CORE, "get_intent", [intentId]));
    if (intent.status === "AUTHORIZED") {
      await writeStep(abi, client, account, "core:start_fulfillment", "start_fulfillment", [intentId], [{type: "string", value: intentId}], async () => {
        const currentReservation = asRecord(await read(client, VAULT, "get_reservation", [intentId]));
        if (currentReservation.status !== "RESERVED") throw new Error("Fulfillment requires a live reservation");
      }, async () => read(client, CORE, "get_intent", [intentId]));
      intent = asRecord(await read(client, CORE, "get_intent", [intentId]));
    }
    if (intent.status === "FULFILLMENT_PENDING" && asText(await read(client, CORE, "get_evidence", [intentId, 1n])) === "") {
      await writeStep(abi, client, account, "core:define_evidence:fulfillment", "define_evidence", [intentId, "FULFILLMENT", fixture.evidenceUrl, fixture.authority, "", 0n, fixture.authority, 1n], [{type: "evidence", kind: "FULFILLMENT", url: fixture.evidenceUrl, authority: fixture.authority}], async () => {}, async () => read(client, CORE, "get_evidence", [intentId, 1n]));
    }
    if (intent.status === "FULFILLMENT_PENDING") {
      await writeStep(abi, client, account, "core:stage_evidence:fulfillment", "stage_evidence", [intentId], [{type: "string", value: intentId}], async () => {}, async () => evidenceReadback(client, intentId, 1n));
      await writeStep(abi, client, account, "core:assess_fulfillment", "assess_fulfillment", [intentId], [{type: "string", value: intentId}], async () => {}, async () => read(client, CORE, "get_intent", [intentId]));
      intent = asRecord(await read(client, CORE, "get_intent", [intentId]));
    }
    const challengeStatus = {live: "BLOCKED_BY_SECOND_SIGNER", note: "No genuinely distinct controlled signer was available; no third-party identity was fabricated."};
    writeArtifact("third-party-challenge-live.json", challengeStatus);
    if (intent.status === "FULFILLED" && intent.settlement_direction === "RELEASE_TO_COUNTERPARTY") {
      let settlement = asRecord(await read(client, CORE, "get_settlement_instruction", [intentId]));
      while (settlement.ready_at && BigInt(settlement.ready_at) > BigInt(nowSeconds())) {
        console.log(`WAITING_FOR_CHALLENGE_WINDOW=${settlement.ready_at}`);
        await sleep(POLL_MS);
        settlement = asRecord(await read(client, CORE, "get_settlement_instruction", [intentId]));
      }
      const currentReservation = asRecord(await read(client, VAULT, "get_reservation", [intentId]));
      let settlementResult: {tx: string} | undefined;
      if (currentReservation.status === "RESERVED") {
        settlementResult = await writeStep(abi, client, account, "vault:request_release", "request_release", [intentId], [{type: "string", value: intentId}], async () => {
          const instruction = asRecord(await read(client, CORE, "get_settlement_instruction", [intentId]));
          if (instruction.direction !== "RELEASE_TO_COUNTERPARTY") throw new Error("Release direction is not authorized");
          if (BigInt(instruction.ready_at) > BigInt(nowSeconds())) throw new Error("Settlement challenge window is still open");
        }, async () => read(client, VAULT, "get_reservation", [intentId]));
      }
      let triggered: any[] = [];
      if (settlementResult) {
        try { triggered = await client.getTriggeredTransactionIds({hash: settlementResult.tx}); } catch { triggered = []; }
      }
      writeArtifact("external-message-observation.json", {intentId, settlementTx: settlementResult?.tx ?? null, triggeredTransactionIds: triggered, observation: "Parent settlement is recorded; child observation depends on Studionet exposure."});
    } else {
      writeArtifact("settlement-blocked.json", {intentId, status: intent.status, direction: intent.settlement_direction ?? "", reason: "Fulfillment did not produce a releasable result."});
    }

    const finalGlobal = assertAccounting(await read(client, VAULT, "get_global_accounting"), "Final global");
    const finalMandateAccounting = assertAccounting(await read(client, VAULT, "get_accounting", [mandateId]), "Final mandate");
    const finalReservation = await read(client, VAULT, "get_reservation", [intentId]);
    const finalIntent = asRecord(await read(client, CORE, "get_intent", [intentId]));
    const finalUnassessed = asRecord(await read(client, CORE, "get_intent", [intent2Id]));
    const authorizationRecord = asRecord(finalIntent.authorization);
    const fulfillmentRecord = asRecord(finalIntent.fulfillment);
    const finalAccounting = {global: finalGlobal, mandate: finalMandateAccounting, reservation: finalReservation, intent: finalIntent, unassessed: finalUnassessed, unassessedProof};
    const finalVectors = {authorization: authorizationRecord.vector ?? {}, fulfillment: fulfillmentRecord.vector ?? {}};
    writeArtifact("qualification-final-readbacks.json", {...finalAccounting, vectors: finalVectors});
    writeArtifact("qualification-run-summary.json", {status: "COMPLETED_LIVE_FLOW", mandateId, intentId, unassessedIntentId: intent2Id, challengeStatus, finalAccounting, vectors: finalVectors});
    console.log("QUALIFICATION_RUN=COMPLETED_LIVE_FLOW");
  } finally {
    signingSecret = "";
    wallet = null;
    account = null;
    client = null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`QUALIFICATION_RUN=STOPPED ${String(error?.message ?? error)}`);
    writeArtifact("qualification-run-summary.json", {status: "STOPPED", error: String(error?.message ?? error)});
    process.exitCode = 1;
  });
}
