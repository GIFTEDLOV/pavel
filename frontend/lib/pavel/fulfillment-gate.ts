import type { EvidenceRecord, IntentStatus } from "./types";

export type FulfillmentEvidenceGate = "FULFILLMENT EVIDENCE NOT DEFINED" | "FULFILLMENT EVIDENCE DEFINED / NOT AUTHENTICATED" | "FULFILLMENT EVIDENCE AUTHENTICATED";

export function fulfillmentEvidenceGate(evidence?: EvidenceRecord): FulfillmentEvidenceGate {
  if (!evidence) return "FULFILLMENT EVIDENCE NOT DEFINED";
  return evidence.authenticated === true ? "FULFILLMENT EVIDENCE AUTHENTICATED" : "FULFILLMENT EVIDENCE DEFINED / NOT AUTHENTICATED";
}

export function canAssessFulfillment(status: IntentStatus, evidence?: EvidenceRecord): boolean {
  return status === "FULFILLMENT_PENDING" && evidence?.authenticated === true;
}
