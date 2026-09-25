import { describe, expect, it } from "vitest";
import { describeProtocolStatus, isConsensusCleared, normalizeChallengeStatus, normalizeIntentStatus } from "../lib/pavel/status";

describe("protocol state honesty", () => {
  it.each([
    "SUBMITTED", "EVIDENCE_PENDING", "EVIDENCE_READY", "EVIDENCE_RETRY_REQUIRED",
    "EVIDENCE_RECOVERY_REQUIRED", "EVIDENCE_REPAIR_REQUIRED", "AUTHORIZATION_PENDING",
    "AUTHORIZATION_RETRY_REQUIRED", "FULFILLMENT_PENDING", "FULFILLMENT_RETRY_REQUIRED", "FULFILLMENT_EXPIRED",
    "CHALLENGE_SUBMITTED", "CHALLENGE_EVIDENCE_PENDING", "CHALLENGE_RETRY_REQUIRED",
    "CHALLENGE_QUALIFYING", "ASSESSMENT_PENDING", "SETTLEMENT_BLOCKED", "TRANSACTION_AMBIGUOUS",
  ] as const)("keeps %s visibly non-cleared", (status) => {
    const view = describeProtocolStatus(status);
    expect(view.tone).not.toBe("success");
    expect(view.label).not.toMatch(/verified|approved|safe|cleared|released/i);
    expect(isConsensusCleared(status)).toBe(false);
  });

  it.each([
    ["SUBMITTED", "SUBMITTED"], ["EVIDENCE_STAGED", "EVIDENCE_PENDING"],
    ["EVIDENCE_READY", "EVIDENCE_READY"], ["AUTHORIZATION_PENDING", "AUTHORIZATION_PENDING"],
    ["AUTHORIZATION_RETRY_REQUIRED", "AUTHORIZATION_RETRY_REQUIRED"], ["REJECTED", "REJECTED"],
    ["AUTHORIZED", "AUTHORIZED"], ["FULFILLMENT_PENDING", "FULFILLMENT_PENDING"],
    ["FULFILLED", "FULFILLED"], ["NOT_FULFILLED", "NOT_FULFILLED"], ["FULFILLMENT_EXPIRED", "FULFILLMENT_EXPIRED"], ["DISPUTED", "DISPUTED"],
    ["ADJUDICATED_RELEASE", "RELEASE_PENDING"], ["ADJUDICATED_REFUND", "REFUND_PENDING"],
    ["EXPIRED", "SUBMITTED"], ["CANCELLED", "SUBMITTED"], ["unknown", "UNRECOGNIZED"],
  ] as const)("normalizes intent %s to %s", (raw, expected) => {
    expect(normalizeIntentStatus(raw)).toBe(expected);
  });

  it.each([
    ["SUBMITTED", "CHALLENGE_SUBMITTED"], ["EVIDENCE_PENDING", "CHALLENGE_EVIDENCE_PENDING"],
    ["EVIDENCE_RETRY_REQUIRED", "CHALLENGE_RETRY_REQUIRED"], ["INADMISSIBLE", "CHALLENGE_INADMISSIBLE"],
    ["QUALIFYING", "CHALLENGE_QUALIFYING"], ["ASSESSMENT_PENDING", "ASSESSMENT_PENDING"],
    ["ASSESSMENT_RETRY_REQUIRED", "ASSESSMENT_RETRY_REQUIRED"], ["RESOLVED", "CHALLENGE_RESOLVED"],
    ["EXPIRED", "CHALLENGE_EXPIRED"], ["unknown", "UNRECOGNIZED"],
  ] as const)("normalizes challenge %s to %s", (raw, expected) => {
    expect(normalizeChallengeStatus(raw)).toBe(expected);
  });

  it("only treats explicit authorization or finalized transaction outcomes as cleared", () => {
    expect(isConsensusCleared("AUTHORIZED")).toBe(true);
    expect(isConsensusCleared("FINALIZED_SUCCESS")).toBe(true);
    expect(isConsensusCleared("REJECTED")).toBe(false);
    expect(isConsensusCleared("FULFILLMENT_PENDING")).toBe(false);
    expect(isConsensusCleared("CHALLENGE_QUALIFYING")).toBe(false);
  });
});
