import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {inspectTransactionResults} from "./run-v2.ts";
import {loadPinnedDependencies} from "./create-root-mandate.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ARTIFACT_DIR = path.join(ROOT, "artifacts", "studionet", "qualification-v2");
const RPC = "https://studio.genlayer.com/api";
const CHAIN_ID = 61999;
const CORE = "0xBb5e144F1b93F5E7b1A5B3fE07ccf677B29b16EA";
const EXPECTED_SIGNER = "0xcb5a845638cbc1f95d7f8343278685682c3ba13f";
const ROOT_TX = "0x18259af48075b6a1a308b3407dd84fce2d3f871ca16e4930d4c4ef50259df962";

function jsonSafe(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    const result: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) result[key] = jsonSafe(item);
    return result;
  }
  return value;
}

function asText(value: any): string {
  return typeof value === "string" ? value : String(value ?? "");
}

async function main() {
  const deps = await loadPinnedDependencies();
  const {createClient, chains} = deps;
  const client = createClient({chain: chains.studionet, endpoint: RPC, account: EXPECTED_SIGNER});
  const safe = async (label: string, action: () => Promise<any>) => {
    try {
      return {supported: true, value: jsonSafe(await action())};
    } catch (error: any) {
      return {supported: false, error: String(error?.message ?? error)};
    }
  };
  const transaction = await client.getTransaction({hash: ROOT_TX});
  const observation = inspectTransactionResults(transaction);
  const readState = async (functionName: string, args: any[] = []) => safe(functionName, () => client.readContract({address: CORE, functionName, args, account: EXPECTED_SIGNER}));
  const mandateCount = await readState("get_mandate_count");
  const mandate = await readState("get_mandate", ["M-1"]);
  const historyLength = await readState("get_history_length");
  const count = Number(mandateCount.value ?? -1);
  const ids = [] as any[];
  if (mandateCount.supported && Number.isSafeInteger(count) && count > 0) {
    for (let index = 0; index < count; index += 1) ids.push(await readState("get_mandate_id", [BigInt(index)]));
  }
  const history = [] as any[];
  const historyCount = Number(historyLength.value ?? -1);
  if (historyLength.supported && Number.isSafeInteger(historyCount) && historyCount >= 0 && historyCount <= 256) {
    for (let index = 0; index < historyCount; index += 1) history.push(await readState("get_history_item", [BigInt(index)]));
  }
  const nonce = {
    latest: await safe("eth_getTransactionCount(latest)", () => client.request({method: "eth_getTransactionCount", params: [EXPECTED_SIGNER, "latest"]})),
    pending: await safe("eth_getTransactionCount(pending)", () => client.request({method: "eth_getTransactionCount", params: [EXPECTED_SIGNER, "pending"]})),
    sdkCurrent: await safe("getCurrentNonce", () => client.getCurrentNonce({address: EXPECTED_SIGNER})),
  };
  const rpcSurfaces = {
    gen_getTransactionStatus: await safe("gen_getTransactionStatus", () => client.request({method: "gen_getTransactionStatus", params: [ROOT_TX]})),
    gen_getTransactionReceipt: await safe("gen_getTransactionReceipt", () => client.request({method: "gen_getTransactionReceipt", params: [ROOT_TX]})),
    eth_getTransactionReceipt: await safe("eth_getTransactionReceipt", () => client.request({method: "eth_getTransactionReceipt", params: [ROOT_TX]})),
    sdkGetTransactionReceipt: await safe("getTransactionReceipt", () => client.getTransactionReceipt({hash: ROOT_TX})),
    debugTraceTransaction: await safe("debugTraceTransaction", () => client.debugTraceTransaction({hash: ROOT_TX})),
  };
  const isSuccessful = (deps as any).isSuccessful ?? (client as any).isSuccessful;
  const successfulSurface = typeof isSuccessful === "function"
    ? await safe("isSuccessful", () => isSuccessful(transaction))
    : {supported: false, error: "isSuccessful is not exported by pinned SDK/client"};
  const validatorSummary = (transaction as any)?.consensus_data?.validators?.map((validator: any) => ({
    address: validator?.node_config?.address,
    vote: validator?.vote,
    execution_result: validator?.execution_result,
    error_code: validator?.genvm_result?.error_code,
    error_description: validator?.genvm_result?.error_description,
    contract_state_hash: validator?.contract_state_hash,
  })) ?? [];
  const leaderReceipts = (transaction as any)?.consensus_data?.leader_receipt ?? (transaction as any)?.leader_receipt ?? [];
  const leaderSummary = leaderReceipts.map((receipt: any) => ({
    result: receipt?.result,
    execution_result: receipt?.execution_result,
    error_code: receipt?.genvm_result?.error_code,
    error_description: receipt?.genvm_result?.error_description,
    contract_state_hash: receipt?.contract_state_hash,
  })) ?? [];
  const mandateValue = mandate.supported && mandate.value && typeof mandate.value === "object" ? mandate.value : {};
  const rootCreated = String(mandateCount.value ?? "") === "1"
    && Object.keys(mandateValue).length > 0
    && asText(mandateValue.principal).toLowerCase() === EXPECTED_SIGNER
    && asText(mandateValue.authorized_agent).toLowerCase() === EXPECTED_SIGNER
    && asText(mandateValue.parent_mandate_id) === "";
  const report = {
    network: "studionet",
    rpc: RPC,
    chainId: CHAIN_ID,
    tx: ROOT_TX,
    transaction,
    consensusStatus: observation.consensusStatus,
    consensusResult: observation.consensusResult,
    executionResult: observation.executionResult,
    executionResultSource: observation.executionResultSource,
    rootMandateExecution: rootCreated ? "SUCCESS_PROVEN_BY_FINALIZED_STATE" : "ERROR_PROVEN_BY_LEADER_RECEIPT_AND_ABSENT_FINALIZED_STATE",
    finalizedState: {mandateCount, mandate, mandateIds: ids, historyLength, history, rootCreated},
    nonce,
    rpcSurfaces,
    isSuccessful: successfulSurface,
    validatorSummary,
    leaderSummary,
    noWriteSubmitted: true,
    generatedAt: new Date().toISOString(),
  };
  mkdirSync(ARTIFACT_DIR, {recursive: true});
  writeFileSync(path.join(ARTIFACT_DIR, "root-reconciliation.json"), JSON.stringify(jsonSafe(report), null, 2) + "\n");
  const transactionsPath = path.join(ARTIFACT_DIR, "transactions.json");
  if (existsSync(transactionsPath)) {
    const transactions = JSON.parse(readFileSync(transactionsPath, "utf8"));
    const index = transactions.transactions?.findIndex((item: any) => item.tx === ROOT_TX) ?? -1;
    if (index >= 0) {
      transactions.transactions[index] = {
        ...transactions.transactions[index],
        status: report.rootCreated ? "SUCCESS_PROVEN_BY_FINALIZED_STATE" : "EXECUTION_ERROR_PROVEN",
        execution: report.executionResult,
        resultName: report.consensusResult,
        error: report.leaderSummary?.[0]?.result?.payload ?? "execution error proven by full transaction data",
        consensusStatus: report.consensusStatus,
        consensusResult: report.consensusResult,
        executionResult: report.executionResult,
        executionResultSource: report.executionResultSource,
        nonceReadback: report.nonce,
        rootMandateState: report.finalizedState,
        reconciliationArtifact: "root-reconciliation.json",
      };
      writeFileSync(transactionsPath, JSON.stringify(jsonSafe(transactions), null, 2) + "\n");
    }
  }
  writeFileSync(path.join(ARTIFACT_DIR, "qualification-run-status.json"), JSON.stringify(jsonSafe({
    status: report.rootCreated ? "ROOT_STATE_PROVEN" : "BLOCKED_DEPLOYED_SOURCE_DEFECT",
    rootMandateTx: ROOT_TX,
    noNewWriteSubmitted: true,
    nextRequiredBoundary: report.rootCreated ? "AFTER_CREATE_MANDATE" : "EXPLICIT_FIXED_SOURCE_DEPLOYMENT",
    reconciliationArtifact: "root-reconciliation.json",
  }), null, 2) + "\n");
  writeFileSync(path.join(ARTIFACT_DIR, "qualification-run-summary.json"), JSON.stringify(jsonSafe({
    status: report.rootCreated ? "ROOT_STATE_PROVEN" : "BLOCKED_DEPLOYED_SOURCE_DEFECT",
    rootMandateTx: ROOT_TX,
    consensusStatus: report.consensusStatus,
    consensusResult: report.consensusResult,
    executionResult: report.executionResult,
    executionResultSource: report.executionResultSource,
    mandateCount: mandateCount.value,
    mandateId: report.rootCreated ? "M-1" : null,
    noNewWriteSubmitted: true,
    blocker: report.rootCreated ? null : "Deployed Core source rejects the Studionet transaction timezone; fixed local source requires explicit redeployment.",
  }), null, 2) + "\n");
  console.log(JSON.stringify(jsonSafe({
    ROOT_MANDATE_TX: ROOT_TX,
    CONSENSUS_STATUS: report.consensusStatus,
    CONSENSUS_RESULT: report.consensusResult,
    EXECUTION_RESULT: report.executionResult,
    EXECUTION_RESULT_SOURCE: report.executionResultSource,
    ROOT_MANDATE_EXECUTION: report.rootMandateExecution,
    MANDATE_COUNT: mandateCount.value,
    MANDATE_ID: ids,
    M1: mandate.value,
    DEPLOYER_NONCE: nonce,
    NO_WRITE_SUBMITTED: true,
  }), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ROOT_RECONCILIATION=FAILED ${String(error?.message ?? error)}`);
    process.exitCode = 1;
  });
}
