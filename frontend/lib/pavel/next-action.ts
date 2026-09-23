import type { EvidenceRecord, IntentRecord, ReservationRecord, SettlementInstruction } from "./types";

export interface NextAction {
  label: string;
  detail: string;
  method?: string;
  tone: "accent" | "warning" | "neutral";
}

export function nextAction(intent: IntentRecord, evidence?: EvidenceRecord, reservation?: ReservationRecord, settlement?: SettlementInstruction): NextAction {
  if (settlement?.status === "CHALLENGE_BLOCKED") return { label: "Wait for challenge resolution", detail: "A qualifying challenge currently blocks settlement.", tone: "warning" };
  if (settlement?.direction && reservation?.status === "RESERVED" && intent.status === "FULFILLED") return { label: settlement.direction === "RELEASE_TO_COUNTERPARTY" ? "Release funds" : "Refund principal", detail: "Core has issued the settlement direction; Vault can act after the challenge window.", method: settlement.direction === "RELEASE_TO_COUNTERPARTY" ? "request_release" : "request_refund", tone: "accent" };
  if (intent.status === "DRAFT") return { label: "Submit intent", detail: "The draft is waiting for the agent to freeze its proposal.", method: "submit_intent", tone: "accent" };
  if (["SUBMITTED", "EVIDENCE_RETRY_REQUIRED", "EVIDENCE_RECOVERY_REQUIRED", "EVIDENCE_REPAIR_REQUIRED"].includes(intent.status) && !evidence) return { label: "Add authorization evidence", detail: "Define and authenticate the evidence snapshot required by the mandate.", method: "define_evidence", tone: "accent" };
  if (intent.status === "EVIDENCE_READY") return { label: "Request authorization", detail: "Authenticated evidence is ready for the bounded semantic review.", method: "authorize_intent", tone: "accent" };
  if (intent.status === "AUTHORIZED" && !reservation) return { label: "Reserve funds", detail: "Vault will recheck authorization, amount, recipient, and budget before reserving.", method: "reserve", tone: "accent" };
  if (intent.status === "AUTHORIZED") return { label: "Begin fulfillment", detail: "Start the fulfillment window against the canonical reservation.", method: "start_fulfillment", tone: "accent" };
  if (intent.status === "FULFILLMENT_PENDING") return { label: "Add fulfillment evidence", detail: "Attach the complete authenticated artifact, then assess fulfillment.", method: "define_evidence", tone: "accent" };
  if (intent.status === "NOT_FULFILLED" || intent.status === "FULFILLMENT_EXPIRED") return { label: "Refund funds", detail: "The Core has recorded a refund direction. The Vault is the only settlement authority.", method: "request_refund", tone: "warning" };
  if (intent.status === "FULFILLED") return { label: "Release funds", detail: "The Core has recorded a release direction after fulfillment.", method: "request_release", tone: "accent" };
  if (intent.status === "REJECTED") return { label: "No valid action", detail: "Authorization was rejected; inspect the failed checks before creating a new intent.", tone: "neutral" };
  return { label: "Inspect canonical state", detail: "PAVEL will only expose a write when the deployed state machine permits it.", tone: "neutral" };
}
