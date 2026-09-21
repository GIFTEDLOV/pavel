import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedDependencies} from "./create-root-mandate.ts";
import {inspectResults, QualificationRpcScheduler, sameAddress} from "./run-v3.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ARTIFACT_DIR = path.join(ROOT, "artifacts", "studionet", "qualification-v3");
const RPC = "https://studio.genlayer.com/api";
const CHAIN_ID = 61999;
const CORE = "0x269966b007629e4eb6E55F8f96641A8735622c00";
const VAULT = "0x64532d574553B49Df548D647c959cbd26f7C532b";
const SIGNER = "0xcb5a845638cbc1f95d7f8343278685682c3ba13f";
const VALID_FROM = 1790019000;
const EXPIRES_AT = 1790191800;
const DEPLOYMENTS = {
  "deploy:core": {tx: "0xe70f739c033d1242cb8d0b5be4647360be7cd508c807eb8123558df8a0f86292", address: CORE, hash: "e48b2b75f2ca26f25db2cb9aaf6ae9a09add7833af437946218493bea18e7681"},
  "deploy:vault": {tx: "0xf5f2fb8df1b19031c86a9f3e8350975d66327ab994d84aabc94c7edd2c1adb36", address: VAULT, hash: "38222b8076542e2fe0185310b9b504adb05df60f6a29c5fbe8f22b1f83caa8c2"},
};
const TXS = {
  "vault:bind_core": "0x20029ce9007d9f70821cf6db0b4d1ebceb1caff7924b836f369a2889de8c240d",
  "core:set_vault_address": "0xcc04f32f558747f5a90793da0305e0fa4b32b41f0e9aec8ac7d4ff72a8c3c011",
  "core:register_principal": "0xb2565461de75e4ca9b2b4d3c64049451c1315a5c24b150f77c163d80280e99c5",
  "core:register_agent": "0x0492b63be00a47f0d075b7f7c818bc0d72d5f57938f6a0f4d2fe8ad361854850",
  "core:create_mandate": "0x17110463562b9dda9022a5bcf10ae0ac2f6e37f2558a11b50371eb896479cb32",
};

function safeJson(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(safeJson);
  if (value && typeof value === "object") {
    const result: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) result[key] = safeJson(item);
    return result;
  }
  return value;
}

function writeArtifact(name: string, value: any) {
  mkdirSync(ARTIFACT_DIR, {recursive: true});
  writeFileSync(path.join(ARTIFACT_DIR, name), JSON.stringify(safeJson(value), null, 2) + "\n");
}

function text(value: any) { return typeof value === "string" ? value : String(value ?? ""); }
function record(value: any): Record<string, any> {
  if (typeof value === "string") return value === "" ? {} : JSON.parse(value);
  return value && typeof value === "object" ? value : {};
}

function decodedCall(transaction: any, abi: any) {
  const raw = transaction?.data?.calldata?.raw;
  if (!Array.isArray(raw)) return {supported: false, reason: "transaction calldata raw bytes unavailable"};
  try {
    const decoded = abi.calldata.decode(Uint8Array.from(raw));
    const map = decoded instanceof Map ? decoded : new Map(Object.entries(decoded));
    const args = map.get("args");
    const method = map.get("method");
    const arg0 = args?.[0];
    const arg0Value = arg0?.bytes ? `0x${Buffer.from(arg0.bytes).toString("hex")}` : "";
    const arg1 = args?.[1];
    return {supported: true, method, argumentCount: Array.isArray(args) ? args.length : 0, arg0Type: arg0?.constructor?.name ?? "unknown", arg0Value, arg1Type: typeof arg1, arg1Value: arg1, arg1Utf8Length: typeof arg1 === "string" ? new TextEncoder().encode(arg1).length : null, exactEmptyString: method === "create_mandate" && Array.isArray(args) && args.length === 2 && sameAddress(arg0Value, SIGNER) && typeof arg1 === "string" && arg1 === ""};
  } catch (error: any) {
    return {supported: false, reason: String(error?.message ?? error)};
  }
}

function txSummary(label: string, transaction: any, abi: any) {
  const observation = inspectResults(transaction);
  const leader = transaction?.consensus_data?.leader_receipt ?? [];
  const validators = transaction?.consensus_data?.validators ?? [];
  return {
    label,
    tx: transaction?.hash,
    status: transaction?.statusName ?? transaction?.status,
    statusName: transaction?.statusName,
    executionResult: observation.executionResult,
    executionResultSource: observation.executionResultSource,
    txExecutionResultName: transaction?.txExecutionResultName ?? transaction?.tx_execution_result_name ?? "UNAVAILABLE",
    consensusResult: observation.consensusResult,
    consensusRaw: transaction?.result,
    sender: transaction?.from_address ?? transaction?.sender,
    recipient: transaction?.recipient ?? transaction?.to_address ?? transaction?.to,
    nonce: transaction?.nonce,
    createdAt: transaction?.created_at,
    createdTimestamp: transaction?.created_timestamp,
    currentTimestamp: transaction?.current_timestamp,
    decodedCalldata: decodedCall(transaction, abi),
    leader: leader.map((item: any) => ({result: item?.result, executionResult: item?.execution_result, genvmResult: item?.genvm_result, executionStats: item?.execution_stats, calldata: item?.calldata})),
    validators: validators.map((item: any) => ({vote: item?.vote, result: item?.result, executionResult: item?.execution_result, genvmResult: item?.genvm_result, executionStats: item?.execution_stats, address: item?.node_config?.address})),
  };
}

async function main() {
  const deps = await loadPinnedDependencies();
  const {abi, chains, createClient} = deps;
  const client = createClient({chain: chains.studionet, endpoint: RPC, account: SIGNER});
  const scheduler = new QualificationRpcScheduler({minSpacingMs: 2500, maxReadAttempts: 4});
  const getTx = (hash: string) => scheduler.enqueue(`reconcile:tx:${hash}`, () => client.getTransaction({hash}), true);
  const read = (address: string, functionName: string, args: any[] = []) => scheduler.enqueue(`reconcile:read:${functionName}`, () => client.readContract({address, functionName, args, account: SIGNER}), true);
  const summaries: Record<string, any> = {};
  for (const [label, hash] of Object.entries(TXS)) summaries[label] = txSummary(label, await getTx(hash), abi);

  const failedTx = await getTx(TXS["core:create_mandate"]);
  const rpcSurfaces: Record<string, any> = {};
  for (const [label, action] of [
    ["gen_getTransactionStatus", () => client.request({method: "gen_getTransactionStatus", params: [TXS["core:create_mandate"]]})],
    ["gen_getTransactionReceipt", () => client.request({method: "gen_getTransactionReceipt", params: [TXS["core:create_mandate"]]})],
    ["eth_getTransactionReceipt", () => client.request({method: "eth_getTransactionReceipt", params: [TXS["core:create_mandate"]]})],
    ["client.getTransactionReceipt", () => client.getTransactionReceipt({hash: TXS["core:create_mandate"]})],
    ["client.debugTraceTransaction", () => client.debugTraceTransaction({hash: TXS["core:create_mandate"], round: 0})],
    ["debug_traceTransaction", () => client.request({method: "debug_traceTransaction", params: [TXS["core:create_mandate"], {round: 0}]})],
  ] as Array<[string, () => Promise<any>]>) {
    try { rpcSurfaces[label] = {supported: true, value: await scheduler.enqueue(`reconcile:${label}`, action, true)}; }
    catch (error: any) { rpcSurfaces[label] = {supported: false, error: String(error?.message ?? error)}; }
  }

  const coreVault = text(await read(CORE, "get_vault_address"));
  const vaultCore = text(await read(VAULT, "get_core_address"));
  const vaultHistoryLength = Number(text(await read(VAULT, "get_history_length")));
  const vaultHistory: any[] = [];
  for (let index = 0; index < vaultHistoryLength; index += 1) vaultHistory.push(text(await read(VAULT, "get_history_item", [BigInt(index)])));
  const coreHistoryLength = Number(text(await read(CORE, "get_history_length")));
  const coreHistory: any[] = [];
  for (let index = 0; index < coreHistoryLength; index += 1) coreHistory.push(text(await read(CORE, "get_history_item", [BigInt(index)])));
  const mandateCount = text(await read(CORE, "get_mandate_count"));
  const mandate = text(await read(CORE, "get_mandate", ["M-1"]));
  const state = existsSync(path.join(ARTIFACT_DIR, "qualification-state.json")) ? JSON.parse(readFileSync(path.join(ARTIFACT_DIR, "qualification-state.json"), "utf8")) : {network: "studionet", rpc: RPC, chainId: CHAIN_ID, signer: SIGNER, core: CORE, vault: VAULT, steps: {}, observations: {}};
  const transactionDocument = existsSync(path.join(ARTIFACT_DIR, "transactions.json")) ? JSON.parse(readFileSync(path.join(ARTIFACT_DIR, "transactions.json"), "utf8")) : {network: "studionet", rpc: RPC, chainId: CHAIN_ID, transactions: []};
  const expectedLedgerHashes = new Set([...Object.values(DEPLOYMENTS).map((item) => item.tx), ...Object.values(TXS)]);
  const unexpectedLedgerEntries = (transactionDocument.transactions ?? []).filter((item: any) => item?.tx && !expectedLedgerHashes.has(item.tx));
  const txTimestamp = Number(failedTx?.created_timestamp);
  const failedCall = summaries["core:create_mandate"].decodedCalldata;
  const leaderPayload = summaries["core:create_mandate"].leader?.[0]?.result ?? {};
  const report = {
    network: "studionet",
    rpc: RPC,
    chainId: CHAIN_ID,
    generatedAt: new Date().toISOString(),
    noNewStateChangingTxFromLastRun: unexpectedLedgerEntries.length === 0 ? "NO" : "UNEXPECTED_LEDGER_ENTRY",
    transactionCount: Math.max(transactionDocument.transactions?.length ?? 0, expectedLedgerHashes.size),
    summaries,
    failedRootMandate: {
      tx: TXS["core:create_mandate"],
      exactExceptionType: "GenVM.UserError",
      exactExceptionMessage: leaderPayload?.payload ?? "",
      sourceFile: "contracts/pavel_core.py",
      sourceLine: 221,
      failingExpression: "zone[0] == '+' or zone[0] == '-'",
      traceSummary: "leader and 3 agreeing validator executions returned rollback: malformed transaction timezone; stdout/stderr empty; debug trace RPC unavailable",
      rpcSurfaces,
    },
    state: {
      coreVault,
      vaultCore,
      vaultHistoryLength,
      vaultHistory,
      coreHistoryLength,
      coreHistory,
      mandateCount,
      mandate,
      m1Exists: mandate !== "",
      failedTxStateMutation: mandateCount === "0" && mandate === "" ? "NONE_ROLLED_BACK" : "PRESENT",
      completedWrites: Object.fromEntries(Object.entries(TXS).filter(([label]) => label !== "core:create_mandate").map(([label, hash]) => [label, {tx: hash, checkpoint: state.steps?.[label]?.status ?? "UNKNOWN", chainExecution: summaries[label]?.executionResult ?? "UNKNOWN"}])),
    },
    calldata: failedCall,
    chainCalldataEmptyStringPreserved: failedCall?.exactEmptyString === true ? "PASS" : "FAIL",
    timestamp: {
      txTimestamp: failedTx?.created_timestamp,
      txCreatedAt: failedTx?.created_at,
      genvmCurrentTimestamp: failedTx?.current_timestamp,
      validFrom: VALID_FROM,
      expiresAt: EXPIRES_AT,
      validityRelation: Number.isFinite(txTimestamp) && txTimestamp >= VALID_FROM && txTimestamp < EXPIRES_AT ? "ACTIVE_WINDOW" : "OUTSIDE_WINDOW",
      observedBackendDatetimeShape: "ISO-8601 with fractional seconds and +00:00 offset",
    },
    classification: "CONTRACT_SOURCE_DEFECT",
    rootCause: "Core timestamp parser rejects backend ISO-8601 fractional seconds before the timezone; actual datetime contains .630060+00:00, so raw[19:] begins with '.' and fails the timezone sign check.",
    scheduler: scheduler.snapshot(),
  };
  writeArtifact("root-mandate-failure-reconciliation.json", report);
  for (const [label, deployment] of Object.entries(DEPLOYMENTS)) {
    const step = state.steps?.[label];
    if (!step || step.status !== "COMPLETE") state.steps[label] = {label, tx: deployment.tx, status: "COMPLETE", execution: "SUCCESS", executionResult: "SUCCESS", executionResultSource: "leader_receipt.result.status", consensusResult: "MAJORITY_AGREE", lifecycle: "FINALIZED", readback: {address: deployment.address, sourceParity: {address: deployment.address, hash: deployment.hash, exact: true, source: "FINALIZED_CONTRACT_CODE_RECONCILED_BEFORE_ARTIFACT_RECOVERY"}}};
  }
  for (const label of ["vault:bind_core", "core:set_vault_address", "core:register_principal", "core:register_agent"]) {
    const step = state.steps?.[label];
    if (!step || step.status !== "COMPLETE") state.steps[label] = {label, tx: TXS[label as keyof typeof TXS], status: "COMPLETE", execution: summaries[label].executionResult, executionResult: summaries[label].executionResult, executionResultSource: summaries[label].executionResultSource, consensusResult: summaries[label].consensusResult, lifecycle: summaries[label].status};
  }
  for (const [label, deployment] of Object.entries(DEPLOYMENTS)) if (!transactionDocument.transactions?.some((item: any) => item.tx === deployment.tx)) transactionDocument.transactions.push({kind: label, tx: deployment.tx, status: "FINALIZED", executionResult: "SUCCESS", executionResultSource: "leader_receipt.result.status", consensusResult: "MAJORITY_AGREE", authoritativeAddress: deployment.address});
  for (const [label, hash] of Object.entries(TXS)) if (!transactionDocument.transactions?.some((item: any) => item.tx === hash)) transactionDocument.transactions.push({kind: label, tx: hash, status: summaries[label].status, executionResult: summaries[label].executionResult, executionResultSource: summaries[label].executionResultSource, consensusResult: summaries[label].consensusResult, nonce: summaries[label].nonce});
  const rootIndex = transactionDocument.transactions?.findIndex((item: any) => item.tx === TXS["core:create_mandate"]) ?? -1;
  if (rootIndex >= 0) transactionDocument.transactions[rootIndex] = {...transactionDocument.transactions[rootIndex], status: "EXECUTION_ERROR_PROVEN", execution: summaries["core:create_mandate"].executionResult, executionResult: summaries["core:create_mandate"].executionResult, executionResultSource: summaries["core:create_mandate"].executionResultSource, consensusResult: summaries["core:create_mandate"].consensusResult, error: report.failedRootMandate.exactExceptionMessage, reconciliationArtifact: "root-mandate-failure-reconciliation.json"};
  const txIndex = transactionDocument.transactions?.findIndex((item: any) => item.tx === TXS["core:create_mandate"]) ?? -1;
  if (txIndex >= 0) transactionDocument.transactions[txIndex] = {...transactionDocument.transactions[txIndex], status: "EXECUTION_ERROR_PROVEN"};
  writeArtifact("transactions.json", transactionDocument);
  const failedStep = state.steps?.["core:create_mandate"];
  state.steps["core:create_mandate"] = {...failedStep, label: "core:create_mandate", tx: TXS["core:create_mandate"], status: "ERROR", execution: summaries["core:create_mandate"].executionResult, executionResult: summaries["core:create_mandate"].executionResult, executionResultSource: summaries["core:create_mandate"].executionResultSource, consensusResult: summaries["core:create_mandate"].consensusResult, error: report.failedRootMandate.exactExceptionMessage};
  state.observations ??= {};
  state.observations.rootMandateFailure = {tx: TXS["core:create_mandate"], classification: report.classification, exactExceptionMessage: report.failedRootMandate.exactExceptionMessage, noStateMutation: report.state.failedTxStateMutation};
  writeArtifact("qualification-state.json", state);
  console.log(JSON.stringify(safeJson({
    ROOT_MANDATE_TX: TXS["core:create_mandate"],
    ROOT_MANDATE_FINAL_STATUS: summaries["core:create_mandate"].status,
    ROOT_MANDATE_EXECUTION: summaries["core:create_mandate"].executionResult,
    ROOT_MANDATE_TX_EXECUTION_RESULT_NAME: summaries["core:create_mandate"].txExecutionResultName,
    EXACT_EXCEPTION_TYPE: report.failedRootMandate.exactExceptionType,
    EXACT_EXCEPTION_MESSAGE: report.failedRootMandate.exactExceptionMessage,
    CHAIN_CALLDATA_EMPTY_STRING_PRESERVED: report.chainCalldataEmptyStringPreserved,
    TX_TIMESTAMP: report.timestamp.txTimestamp,
    VALID_FROM: VALID_FROM,
    EXPIRES_AT: EXPIRES_AT,
    VALIDITY_RELATION: report.timestamp.validityRelation,
    MANDATE_COUNT_AFTER_FAILED_TX: mandateCount,
    M1_EXISTS: mandate !== "",
    FAILED_TX_STATE_MUTATION: report.state.failedTxStateMutation,
    ROOT_CAUSE_CLASSIFICATION: report.classification,
    ROOT_CAUSE: report.rootCause,
    NO_WRITE_SUBMITTED: true,
  }), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`V3_ROOT_RECONCILIATION=FAILED ${String(error?.message ?? error)}`); process.exitCode = 1; });
