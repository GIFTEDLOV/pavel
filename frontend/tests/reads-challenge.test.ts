import { describe, expect, it } from "vitest";
import { readProtocolSnapshot } from "../lib/pavel/reads";

const address = "0x1111111111111111111111111111111111111111" as const;
const intent = { intent_id: "I-1", mandate_id: "M-1", agent: address, principal: address, counterparty: address, counterparty_identity_id: "C-1", counterparty_authority_origin: "evidence.example", counterparty_identity_fingerprint: "a".repeat(64), recipient: address, amount: "1", title: "GPU", purpose: "Infrastructure", deliverable: "GPU", commercial_terms: "1 GEN", fulfillment_criteria: "Authenticated fulfillment", status: "DISPUTED", intent_fingerprint: "b".repeat(64), current_snapshot_id: "S-1", settlement_direction: "RELEASE_TO_COUNTERPARTY", challenge_deadline: "2000" };
const evidence = (id: string, kind: string, sequence: string, challengeId = "") => ({ evidence_id: id, mandate_id: "M-1", intent_id: "I-1", evidence_kind: kind, origin_url: `https://${challengeId ? "challenge" : "evidence"}.example/${id}`, expected_authority: challengeId ? "challenge.example" : "evidence.example", expected_hash: "c".repeat(64), committed_sha256: "c".repeat(64), committed_byte_length: "12", approved_recovery_authority: "mirror.example", challenge_id: challengeId, sequence, policy_fingerprint: challengeId ? "d".repeat(64) : "b".repeat(64), identity_fingerprint: "e".repeat(64) });

describe("canonical challenge read model", () => {
  it("enumerates challenge records, evidence, independent snapshots, and blocked settlement with latest-final reads", async () => {
    const calls: Array<{ functionName: string; args: readonly unknown[] }> = [];
    const client = { readContract: async ({ functionName, args = [] }: { functionName: string; args?: readonly unknown[]; [key: string]: unknown }) => {
      calls.push({ functionName, args });
      const key = `${functionName}:${args.map(String).join(",")}`;
      const values: Record<string, unknown> = {
        "get_global_accounting:": JSON.stringify({}),
        "get_mandate_count:": 1,
        "get_mandate_id:0": "M-1",
        "get_mandate:M-1": JSON.stringify({ mandate_id: "M-1", principal: address, authorized_agent: address, status: "SEALED" }),
        "get_intent_count:": 1,
        "get_intent_id:0": "I-1",
        "get_intent:I-1": JSON.stringify(intent),
        "get_authorization_for_vault:I-1": JSON.stringify({ authorization_decision: "AUTHORIZED" }),
        "get_reservation:I-1": JSON.stringify({ intent_id: "I-1", status: "RESERVED" }),
        "get_settlement_instruction:I-1": JSON.stringify({ intent_id: "I-1", mandate_id: "M-1", status: "CHALLENGE_BLOCKED", direction: "", oldest_open_challenge: "D-1", ready_at: "1000", challenge_deadline: "2000", fulfillment_deadline: "900", fulfillment_result: {}, recipient: address, principal: address, amount: "1", intent_fingerprint: "b".repeat(64) }),
        "get_evidence:I-1,0": JSON.stringify(evidence("E-1", "QUOTE", "0")),
        "get_evidence:I-1,1": JSON.stringify(evidence("E-2", "FULFILLMENT", "1")),
        "get_snapshot:S-1": JSON.stringify({ snapshot_id: "S-1", intent_id: "I-1", mandate_id: "M-1", parent_snapshot_id: "", captured_at: "2030-01-01T00:00:00Z", policy_version: "1", evidence_set_identity: "set-1", fingerprint: "f".repeat(64), captures: [{ evidence_id: "E-1", sequence: "0", url: "https://evidence.example/E-1", transport_url: "https://evidence.example/E-1", status: 200, capture_class: "AUTHENTICATED", sha256: "c".repeat(64), byte_length: 12 }] }),
        "get_challenge_count:I-1": 1,
        "get_challenge_id:I-1,0": "D-1",
        "get_dispute:D-1": JSON.stringify({ challenge_id: "D-1", dispute_id: "D-1", intent_id: "I-1", challenger: address, reason: "adverse evidence", opened_at: "2030-01-01T00:00:00Z", deadline: "2000", original_fulfillment: "{}", original_snapshot_id: "S-1", base_intent_status: "FULFILLED", status: "QUALIFYING", last_error: "", evidence_ids: "E-3", evidence_ids_hash: "h", evidence_set_identity: "set-2", independent_snapshot_id: "S-2", adjudication: "", resolved_at: "", submission_fingerprint: "s", fingerprint: "p" }),
        "get_challenge_evidence:D-1,0": JSON.stringify(evidence("E-3", "CHALLENGE", "0", "D-1")),
        "get_snapshot:S-2": JSON.stringify({ snapshot_id: "S-2", intent_id: "I-1", mandate_id: "M-1", parent_snapshot_id: "S-1", captured_at: "2030-01-01T00:00:00Z", policy_version: "1", evidence_set_identity: "set-2", fingerprint: "g".repeat(64), challenge_id: "D-1", captures: [{ evidence_id: "E-3", sequence: "0", url: "https://challenge.example/E-3", transport_url: "https://challenge.example/E-3", status: 200, capture_class: "AUTHENTICATED", sha256: "c".repeat(64), byte_length: 12 }] }),
      };
      if (key in values) return values[key];
      throw new Error(`missing mocked read ${key}`);
    } };

    const snapshot = await readProtocolSnapshot({ client: client as never });
    expect(snapshot.settlements["I-1"]?.status).toBe("CHALLENGE_BLOCKED");
    expect(snapshot.challenges["I-1"]).toHaveLength(1);
    expect(snapshot.challenges["I-1"][0].status).toBe("QUALIFYING");
    expect(snapshot.challengeEvidence["D-1"][0].evidence_kind).toBe("CHALLENGE");
    expect(snapshot.challengeSnapshots["D-1"]?.snapshot_id).toBe("S-2");
    expect(snapshot.fulfillmentEvidence["I-1"]?.sequence).toBe("1");
    expect(snapshot.fulfillmentEvidence["I-1"]?.authenticated).toBe(false);
    expect(calls.some((call) => call.functionName === "get_challenge_count")).toBe(true);
    expect(calls.some((call) => call.functionName === "get_challenge_id")).toBe(true);
    expect(calls.some((call) => call.functionName === "get_challenge_evidence")).toBe(true);
    expect(calls.every((call) => "functionName" in call)).toBe(true);
  });
});
