import { describe, expect, it } from "vitest";
import { nextAction } from "../lib/pavel/next-action";
import type { IntentRecord } from "../lib/pavel/types";

const intent = (status: IntentRecord["status"]): IntentRecord => ({
  intent_id: "I-1", mandate_id: "M-1", agent: "0x1111111111111111111111111111111111111111", principal: "0x2222222222222222222222222222222222222222", counterparty: "0x3333333333333333333333333333333333333333", counterparty_identity_id: "C-1", counterparty_authority_origin: "docs.genlayer.com", counterparty_identity_fingerprint: "", recipient: "0x4444444444444444444444444444444444444444", amount: "1", title: "", purpose: "", deliverable: "", commercial_terms: "", fulfillment_criteria: "", status, intent_fingerprint: "", current_snapshot_id: "", settlement_direction: "", challenge_deadline: "0",
});

describe("canonical next-action guidance", () => {
  it("does not require a wallet for the read-derived state machine", () => {
    expect(nextAction(intent("EVIDENCE_READY")).method).toBe("authorize_intent");
    expect(nextAction(intent("AUTHORIZED")).method).toBe("reserve");
  });

  it("only exposes settlement when Core has supplied a direction", () => {
    expect(nextAction(intent("FULFILLED"), undefined, { intent_id: "I-1", mandate_id: "M-1", principal: intent("FULFILLED").principal, agent: intent("FULFILLED").agent, counterparty: intent("FULFILLED").counterparty, recipient: intent("FULFILLED").recipient, amount: "1", intent_fingerprint: "", status: "RESERVED", reserved_at: "", settlement_id: "" }, { intent_id: "I-1", mandate_id: "M-1", status: "FULFILLED", direction: "RELEASE_TO_COUNTERPARTY", oldest_open_challenge: "", ready_at: "0", challenge_deadline: "0", fulfillment_deadline: "0", fulfillment_result: {}, recipient: intent("FULFILLED").recipient, principal: intent("FULFILLED").principal, amount: "1", intent_fingerprint: "" }).method).toBe("request_release");
    expect(nextAction(intent("REJECTED")).method).toBeUndefined();
  });
});
