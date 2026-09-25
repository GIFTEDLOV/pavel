import { describe, expect, it } from "vitest";
import { canAssessFulfillment, fulfillmentEvidenceGate } from "../lib/pavel/fulfillment-gate";

const definition = { evidence_id: "E-2", mandate_id: "M-1", intent_id: "I-1", evidence_kind: "FULFILLMENT", origin_url: "https://evidence.example/full", expected_authority: "evidence.example", expected_hash: "", committed_sha256: "a".repeat(64), committed_byte_length: "12", approved_recovery_authority: "evidence.example", sequence: "1", policy_fingerprint: "b".repeat(64), identity_fingerprint: "c".repeat(64) };

describe("fulfillment evidence gating", () => {
  it("distinguishes undefined, defined-but-unauthenticated, and authenticated evidence", () => {
    expect(fulfillmentEvidenceGate()).toBe("FULFILLMENT EVIDENCE NOT DEFINED");
    expect(fulfillmentEvidenceGate(definition)).toBe("FULFILLMENT EVIDENCE DEFINED / NOT AUTHENTICATED");
    expect(fulfillmentEvidenceGate({ ...definition, authenticated: true })).toBe("FULFILLMENT EVIDENCE AUTHENTICATED");
  });

  it("only makes assessment ready from pending with canonical authenticated evidence", () => {
    expect(canAssessFulfillment("FULFILLMENT_PENDING", definition)).toBe(false);
    expect(canAssessFulfillment("FULFILLMENT_PENDING", { ...definition, authenticated: true })).toBe(true);
    expect(canAssessFulfillment("FULFILLED", { ...definition, authenticated: true })).toBe(false);
  });
});
