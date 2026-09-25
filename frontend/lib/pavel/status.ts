import type { ChallengeStatus, IntentStatus, ProtocolStatus } from "./types";

export type StatusTone = "neutral" | "success" | "danger" | "warning";

const labels: Record<ProtocolStatus, { label: string; tone: StatusTone }> = {
  LOADING: { label: "Loading canonical state", tone: "neutral" },
  DISCONNECTED: { label: "Wallet disconnected", tone: "neutral" },
  WRONG_NETWORK: { label: "Wrong network", tone: "danger" },
  EMPTY: { label: "No canonical records", tone: "neutral" },
  UNRECOGNIZED: { label: "Unrecognized canonical state", tone: "warning" },
  SUBMITTED: { label: "Unassessed / submitted", tone: "neutral" },
  EVIDENCE_PENDING: { label: "Evidence capture pending", tone: "warning" },
  EVIDENCE_READY: { label: "Evidence snapshot ready; not assessed", tone: "neutral" },
  EVIDENCE_RETRY_REQUIRED: { label: "Evidence capture retry required", tone: "warning" },
  EVIDENCE_RECOVERY_REQUIRED: { label: "Evidence recovery required", tone: "warning" },
  EVIDENCE_REPAIR_REQUIRED: { label: "Evidence requires repair", tone: "warning" },
  AUTHORIZATION_PENDING: { label: "Authorization consensus pending", tone: "warning" },
  AUTHORIZATION_RETRY_REQUIRED: { label: "Authorization retry required", tone: "warning" },
  AUTHORIZATION_RETRY: { label: "Authorization retry required", tone: "warning" },
  REJECTED: { label: "Consensus rejection", tone: "danger" },
  AUTHORIZED: { label: "Consensus-authorized", tone: "success" },
  FUNDS_RESERVED: { label: "Funds reserved", tone: "success" },
  RESERVED: { label: "Funds reserved", tone: "success" },
  FULFILLED: { label: "Fulfillment consensus recorded", tone: "success" },
  NOT_FULFILLED: { label: "Fulfillment not established", tone: "danger" },
  FULFILLMENT_PENDING: { label: "Fulfillment assessment pending", tone: "warning" },
  FULFILLMENT_RETRY_REQUIRED: { label: "Fulfillment assessment retry required", tone: "warning" },
  FULFILLMENT_EXPIRED: { label: "Fulfillment expired; refund direction recorded", tone: "danger" },
  CHALLENGE_SUBMITTED: { label: "Challenge submitted; not qualifying", tone: "neutral" },
  CHALLENGE_EVIDENCE_PENDING: { label: "Challenge evidence pending", tone: "warning" },
  CHALLENGE_RETRY_REQUIRED: { label: "Challenge evidence retry required", tone: "warning" },
  CHALLENGE_INADMISSIBLE: { label: "Challenge inadmissible", tone: "danger" },
  CHALLENGE_QUALIFYING: { label: "Qualifying challenge blocks settlement", tone: "warning" },
  ASSESSMENT_PENDING: { label: "Challenge assessment pending", tone: "warning" },
  ASSESSMENT_RETRY_REQUIRED: { label: "Challenge assessment retry required", tone: "warning" },
  CHALLENGE_RESOLVED: { label: "Challenge resolved", tone: "neutral" },
  CHALLENGE_EXPIRED: { label: "Challenge expired", tone: "neutral" },
  SETTLEMENT_BLOCKED: { label: "Settlement blocked by qualifying challenge", tone: "warning" },
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

const intentStatusMap: Record<IntentStatus, ProtocolStatus> = {
  DRAFT: "SUBMITTED",
  SUBMITTED: "SUBMITTED",
  EVIDENCE_STAGED: "EVIDENCE_PENDING",
  EVIDENCE_READY: "EVIDENCE_READY",
  EVIDENCE_RETRY_REQUIRED: "EVIDENCE_RETRY_REQUIRED",
  EVIDENCE_RECOVERY_REQUIRED: "EVIDENCE_RECOVERY_REQUIRED",
  EVIDENCE_REPAIR_REQUIRED: "EVIDENCE_REPAIR_REQUIRED",
  AUTHORIZATION_RETRY_REQUIRED: "AUTHORIZATION_RETRY_REQUIRED",
  AUTHORIZATION_PENDING: "AUTHORIZATION_PENDING",
  REJECTED: "REJECTED",
  AUTHORIZED: "AUTHORIZED",
  FULFILLMENT_PENDING: "FULFILLMENT_PENDING",
  FULFILLMENT_RETRY_REQUIRED: "FULFILLMENT_RETRY_REQUIRED",
  FULFILLMENT_EXPIRED: "FULFILLMENT_EXPIRED",
  FULFILLED: "FULFILLED",
  NOT_FULFILLED: "NOT_FULFILLED",
  DISPUTED: "DISPUTED",
  ADJUDICATED_RELEASE: "RELEASE_PENDING",
  ADJUDICATED_REFUND: "REFUND_PENDING",
  EXPIRED: "SUBMITTED",
  CANCELLED: "SUBMITTED",
};

export function normalizeIntentStatus(status: string): ProtocolStatus {
  return status in intentStatusMap ? intentStatusMap[status as IntentStatus] : "UNRECOGNIZED";
}

export function normalizeChallengeStatus(status: string): ProtocolStatus {
  const map: Record<ChallengeStatus, ProtocolStatus> = {
    SUBMITTED: "CHALLENGE_SUBMITTED",
    EVIDENCE_PENDING: "CHALLENGE_EVIDENCE_PENDING",
    EVIDENCE_RETRY_REQUIRED: "CHALLENGE_RETRY_REQUIRED",
    INADMISSIBLE: "CHALLENGE_INADMISSIBLE",
    QUALIFYING: "CHALLENGE_QUALIFYING",
    ASSESSMENT_PENDING: "ASSESSMENT_PENDING",
    ASSESSMENT_RETRY_REQUIRED: "ASSESSMENT_RETRY_REQUIRED",
    RESOLVED: "CHALLENGE_RESOLVED",
    EXPIRED: "CHALLENGE_EXPIRED",
  };
  return status in map ? map[status as ChallengeStatus] : "UNRECOGNIZED";
}
