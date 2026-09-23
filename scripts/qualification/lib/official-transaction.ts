/**
 * The pinned 0.39.2 Studionet client predates the newer
 * waitForFinalization/isSuccessful helpers.  It still provides the official
 * transaction client and finalized transaction endpoint, but Studio returns
 * the execution result in the legacy consensus envelope.  This file is the
 * only compatibility boundary for that representation.
 */

export const FALLBACK_LATEST_FINAL = "latest-final";
const ACCEPTED_STATUS = "ACCEPTED";
const FINAL_STATUS = "FINALIZED";
const SUCCESS_EXECUTION = "FINISHED_WITH_RETURN";
const ERROR_EXECUTION = "FINISHED_WITH_ERROR";

type AnyRecord = Record<string, any>;

function text(value: any) {
  return typeof value === "string" ? value : String(value ?? "");
}

function canonicalExecution(value: any): string | undefined {
  const normalized = text(value).trim().toUpperCase();
  if (["FINISHED_WITH_RETURN", "SUCCESS", "RETURN", "COMMITTED", "OK", "1"].includes(normalized)) return SUCCESS_EXECUTION;
  if (["FINISHED_WITH_ERROR", "ERROR", "ROLLBACK", "FAILED", "FAILURE", "2"].includes(normalized)) return ERROR_EXECUTION;
  if (["NOT_VOTED", "0", "UNDETERMINED", "TIMEOUT", "UNKNOWN"].includes(normalized)) return undefined;
  return undefined;
}

function isQuorumCancellation(receipt: AnyRecord) {
  const code = text(receipt?.genvm_result?.error_code ?? receipt?.genvmResult?.errorCode).toUpperCase();
  return code === "CONSENSUS_VALIDATOR_QUORUM_REACHED" || code.startsWith("CONSENSUS_");
}

/**
 * Legacy Studio responses omit txExecutionResultName at the top level.  The
 * stable SDK exposes the execution observations in its official
 * consensus_data response.  Validator observations are preferred; a leader
 * observation is only a last-resort legacy fallback when validators are not
 * returned.  Quorum-cancelled observations are not execution failures.
 */
function legacyExecution(raw: AnyRecord): {name?: string; source?: string} {
  const consensus = raw?.consensus_data ?? raw?.consensusData ?? {};
  const validatorReceipts = Array.isArray(consensus.validators) ? consensus.validators : [];
  const receipts = validatorReceipts.length
    ? validatorReceipts.map((receipt: AnyRecord) => ({receipt, source: "legacy-consensus-validators"}))
    : (Array.isArray(consensus.leader_receipt) ? consensus.leader_receipt : []).map((receipt: AnyRecord) => ({receipt, source: "legacy-consensus-leader-fallback"}));

  const observations = receipts
    .filter(({receipt}) => !isQuorumCancellation(receipt))
    .map(({receipt, source}) => ({execution: canonicalExecution(receipt?.execution_result ?? receipt?.executionResult ?? receipt?.result?.status), source}))
    .filter(({execution}) => execution !== undefined);
  if (!observations.length) return {};

  const hasSuccess = observations.some(({execution}) => execution === SUCCESS_EXECUTION);
  const hasError = observations.some(({execution}) => execution === ERROR_EXECUTION);
  if (hasSuccess && !hasError) return {name: SUCCESS_EXECUTION, source: observations[0].source};
  if (hasError && !hasSuccess) return {name: ERROR_EXECUTION, source: observations[0].source};
  return {source: "legacy-consensus-conflict"};
}

export function normalizeTransaction(raw: AnyRecord, sdk: AnyRecord = {}): AnyRecord {
  const directExecution = canonicalExecution(
    raw?.txExecutionResultName ?? raw?.tx_execution_result_name ?? raw?.executionResultName ?? raw?.execution_result_name ??
    raw?.txExecutionResult ?? raw?.tx_execution_result ?? raw?.executionResult
  );
  const legacy = directExecution ? {} : legacyExecution(raw);
  const execution = directExecution ?? legacy.name;
  const statusName = text(raw?.statusName ?? raw?.status_name ?? raw?.status).toUpperCase();
  const resultName = raw?.resultName ?? raw?.result_name ?? sdk.transactionResultNumberToName?.[String(raw?.result)];
  const executionSource = raw?.executionSource ?? (directExecution ? "sdk-normalized" : legacy.source ?? "missing");
  const lifecycle = raw?.lifecycle ?? {
    statusName,
    txExecutionResultName: execution,
    executionSource,
  };
  return {
    ...raw,
    statusName,
    resultName,
    txExecutionResultName: execution,
    lifecycle,
    recipient: raw?.recipient ?? raw?.to_address ?? raw?.to,
    txDataDecoded: raw?.txDataDecoded ?? (raw?.data?.calldata ? {callData: raw.data.calldata, type: "call"} : undefined),
    executionSource,
  };
}

/**
 * Compatibility equivalent of the newer SDK isSuccessful(tx).
 *
 * Transaction execution success is intentionally independent from the
 * consensus result name.  MAJORITY_DISAGREE can accompany a successful
 * FINISHED_WITH_RETURN execution; the application's contract readback is the
 * separate business-outcome decision.
 */
export function isSuccessful(raw: AnyRecord): boolean {
  const tx = normalizeTransaction(raw);
  return (tx.statusName === ACCEPTED_STATUS || tx.statusName === FINAL_STATUS) &&
    tx.txExecutionResultName === SUCCESS_EXECUTION;
}

export function requireSuccessfulExecution(raw: AnyRecord): AnyRecord {
  const tx = normalizeTransaction(raw);
  if (!isSuccessful(tx)) {
    throw new Error(`Transaction ${text(tx.hash ?? tx.tx_id)} is not a successful finalized execution: status=${tx.statusName || "UNKNOWN"} execution=${tx.txExecutionResultName || "UNKNOWN"} result=${tx.resultName || "UNKNOWN"}`);
  }
  return tx;
}

export async function waitForFinalization({client, hash, interval = 3000, retries = 120}: {client: AnyRecord; hash: string; interval?: number; retries?: number}) {
  let waited: AnyRecord;
  if (typeof client.waitForFinalization === "function") {
    waited = await client.waitForFinalization({hash, fullTransaction: true});
  } else if (typeof client.waitForTransactionReceipt === "function") {
    waited = await client.waitForTransactionReceipt({hash, status: FINAL_STATUS, fullTransaction: true, interval, retries});
  } else {
    for (let attempt = 0; attempt < retries; attempt += 1) {
      waited = await client.getTransaction({hash});
      if (text(waited?.statusName ?? waited?.status).toUpperCase() === FINAL_STATUS) break;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    if (!waited || text(waited.statusName ?? waited.status).toUpperCase() !== FINAL_STATUS) throw new Error(`Transaction ${hash} did not reach FINALIZED`);
  }
  const latest = typeof client.getTransaction === "function" ? await client.getTransaction({hash}) : undefined;
  return normalizeTransaction({...waited, ...latest});
}

export async function reconcileSameHash({client, hash, interval, retries}: {client: AnyRecord; hash: string; interval?: number; retries?: number}) {
  const tx = await waitForFinalization({client, hash, interval, retries});
  return {tx, successful: isSuccessful(tx)};
}

export async function sendWriteOnce({client, operation, request, persistHash}: {client: AnyRecord; operation: string; request: AnyRecord; persistHash: (hash: string) => Promise<void> | void}) {
  const hash = String(await client.writeContract(request));
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error(`${operation} returned an invalid transaction hash`);
  await persistHash(hash);
  return hash;
}

/**
 * Deployment has the same exactly-once discipline as a contract write, but it
 * uses the SDK's official deployContract surface.  Keeping it here prevents
 * deployment from acquiring a second reconciliation/checkpoint path.
 */
export async function sendDeployOnce({client, operation, request, persistHash}: {client: AnyRecord; operation: string; request: AnyRecord; persistHash: (hash: string) => Promise<void> | void}) {
  const hash = String(await client.deployContract(request));
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error(`${operation} returned an invalid deployment transaction hash`);
  await persistHash(hash);
  return hash;
}

export async function readLatestFinalPostcondition({client, address, functionName, args = [], account, transactionHashVariant = FALLBACK_LATEST_FINAL}: {client: AnyRecord; address: string; functionName: string; args?: any[]; account?: any; transactionHashVariant?: string}) {
  return client.readContract({address, functionName, args, account, transactionHashVariant});
}

export async function resumePendingOperation({client, hash, requireSuccess = true}: {client: AnyRecord; hash: string; requireSuccess?: boolean}) {
  const reconciled = await reconcileSameHash({client, hash});
  if (requireSuccess) requireSuccessfulExecution(reconciled.tx);
  return reconciled;
}

export async function getTriggeredTransactionIds({client, hash}: {client: AnyRecord; hash: string}) {
  if (typeof client.getTriggeredTransactionIds !== "function") throw new Error("Official SDK does not expose getTriggeredTransactionIds");
  return client.getTriggeredTransactionIds({hash});
}

export const transactionCompatibility = {
  finalStatus: FINAL_STATUS,
  successExecution: SUCCESS_EXECUTION,
  errorExecution: ERROR_EXECUTION,
};
