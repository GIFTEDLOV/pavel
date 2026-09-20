export type Address = `0x${string}`;

export type ProtocolStatus =
  | "LOADING"
  | "DISCONNECTED"
  | "WRONG_NETWORK"
  | "EMPTY"
  | "SUBMITTED"
  | "EVIDENCE_READY"
  | "AUTHORIZATION_PENDING"
  | "AUTHORIZATION_RETRY_REQUIRED"
  | "AUTHORIZATION_RETRY"
  | "REJECTED"
  | "AUTHORIZED"
  | "FUNDS_RESERVED"
  | "FULFILLMENT_PENDING"
  | "DISPUTED"
  | "RELEASE_PENDING"
  | "REFUND_PENDING"
  | "TRANSACTION_AMBIGUOUS"
  | "EXECUTION_FAILED"
  | "FINALIZED_SUCCESS";

export type MandateStatus = "DRAFT" | "SEALED" | "REVOKED";
export type IntentStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "EVIDENCE_STAGED"
  | "EVIDENCE_READY"
  | "EVIDENCE_RETRY_REQUIRED"
  | "EVIDENCE_RECOVERY_REQUIRED"
  | "EVIDENCE_REPAIR_REQUIRED"
  | "AUTHORIZATION_RETRY_REQUIRED"
  | "AUTHORIZATION_PENDING"
  | "REJECTED"
  | "AUTHORIZED"
  | "FULFILLMENT_PENDING"
  | "FULFILLMENT_RETRY_REQUIRED"
  | "FULFILLED"
  | "NOT_FULFILLED"
  | "DISPUTED"
  | "ADJUDICATED_RELEASE"
  | "ADJUDICATED_REFUND"
  | "EXPIRED"
  | "CANCELLED";

export type SettlementDirection = "RELEASE_TO_COUNTERPARTY" | "REFUND_TO_PRINCIPAL" | "INDETERMINATE_RETRY";

export interface MandateRecord {
  mandate_id: string;
  principal: Address;
  authorized_agent: Address;
  parent_mandate_id: string;
  title: string;
  purpose: string;
  constitution: string;
  permitted_activity: string;
  forbidden_activity: string;
  maximum_single_transaction: string;
  epoch_budget: string;
  epoch_duration_seconds: string;
  total_budget: string;
  valid_from: string;
  expires_at: string;
  challenge_window_seconds: string;
  evidence_policy: string;
  fulfillment_policy: string;
  recovery_policy: string;
  definition_hash: string;
  status: MandateStatus;
}

export interface IntentRecord {
  intent_id: string;
  mandate_id: string;
  agent: Address;
  principal: Address;
  counterparty: Address;
  counterparty_identity_id: string;
  counterparty_authority_origin: string;
  counterparty_identity_fingerprint: string;
  recipient: Address;
  amount: string;
  title: string;
  purpose: string;
  deliverable: string;
  commercial_terms: string;
  fulfillment_criteria: string;
  status: IntentStatus;
  intent_fingerprint: string;
  current_snapshot_id: string;
  settlement_direction: SettlementDirection | "";
  challenge_deadline: string;
}

export interface AccountingRecord {
  mandate_id: string;
  deposited: string;
  available: string;
  reserved: string;
  release_pending: string;
  refund_pending: string;
  recovered: string;
  committed: string;
  epoch_start: string;
  epoch_spent: string;
  conserved: boolean;
}

export interface SettlementRecord {
  settlement_id: string;
  intent_id: string;
  direction: SettlementDirection;
  recipient: Address;
  amount: string;
  status: "RELEASE_PENDING" | "REFUND_PENDING";
  external_observation: "UNCONFIRMED";
}
