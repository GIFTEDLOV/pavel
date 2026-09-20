import type { ProtocolStatus } from "./types";

export type StatusTone = "neutral" | "success" | "danger" | "warning";

const labels: Record<ProtocolStatus, { label: string; tone: StatusTone }> = {
  LOADING: { label: "Loading canonical state", tone: "neutral" },
  DISCONNECTED: { label: "Wallet disconnected", tone: "neutral" },
  WRONG_NETWORK: { label: "Wrong network", tone: "danger" },
  EMPTY: { label: "No canonical records", tone: "neutral" },
  SUBMITTED: { label: "Unassessed / submitted", tone: "neutral" },
  EVIDENCE_READY: { label: "Evidence snapshot ready; not assessed", tone: "neutral" },
  AUTHORIZATION_PENDING: { label: "Authorization consensus pending", tone: "warning" },
  AUTHORIZATION_RETRY_REQUIRED: { label: "Authorization retry required", tone: "warning" },
  AUTHORIZATION_RETRY: { label: "Authorization retry required", tone: "warning" },
  REJECTED: { label: "Consensus rejection", tone: "danger" },
  AUTHORIZED: { label: "Consensus-authorized", tone: "success" },
  FUNDS_RESERVED: { label: "Funds reserved", tone: "success" },
  FULFILLMENT_PENDING: { label: "Fulfillment assessment pending", tone: "warning" },
  DISPUTED: { label: "Challenge open", tone: "warning" },
  RELEASE_PENDING: { label: "Release transfer pending observation", tone: "warning" },
  REFUND_PENDING: { label: "Refund transfer pending observation", tone: "warning" },
  TRANSACTION_AMBIGUOUS: { label: "Transaction status ambiguous", tone: "warning" },
  EXECUTION_FAILED: { label: "Transaction execution failed", tone: "danger" },
  FINALIZED_SUCCESS: { label: "Finalized and execution-successful", tone: "success" },
};

export function describeProtocolStatus(status: ProtocolStatus) {
  return labels[status];
}

export function isConsensusCleared(status: ProtocolStatus) {
  return status === "AUTHORIZED" || status === "FINALIZED_SUCCESS";
}
