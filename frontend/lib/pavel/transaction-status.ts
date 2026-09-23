export type NormalizedTransactionState =
  | "WALLET_DISCONNECTED"
  | "AWAITING_SIGNATURE"
  | "USER_REJECTED"
  | "BROADCASTING"
  | "TX_ID_RECEIVED"
  | "ACCEPTED"
  | "FINALIZING"
  | "FINALIZED_SUCCESS"
  | "FINALIZED_EXECUTION_FAILED"
  | "AMBIGUOUS_POLLING"
  | "READBACK_MISMATCH";

export type TransactionObservation = {
  statusName?: string;
  resultName?: string;
  txExecutionResultName?: string;
  error?: string;
};

export function isDurableExecutionSuccess(observation: TransactionObservation): boolean {
  return observation.statusName === "FINALIZED" && observation.txExecutionResultName === "FINISHED_WITH_RETURN";
}

export function normalizeTransactionObservation(observation: TransactionObservation): NormalizedTransactionState {
  if (observation.error) return "AMBIGUOUS_POLLING";
  if (!observation.statusName) return "TX_ID_RECEIVED";
  if (observation.statusName === "FINALIZED") {
    return isDurableExecutionSuccess(observation) ? "FINALIZED_SUCCESS" : "FINALIZED_EXECUTION_FAILED";
  }
  if (observation.statusName === "ACCEPTED") return "ACCEPTED";
  return "FINALIZING";
}
