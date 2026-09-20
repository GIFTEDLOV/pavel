import { describe, expect, it } from "vitest";
import { describeProtocolStatus, isConsensusCleared } from "../lib/pavel/status";

describe("protocol state honesty", () => {
  it("keeps unassessed and evidence-ready states neutral", () => {
    for (const status of ["SUBMITTED", "EVIDENCE_READY", "AUTHORIZATION_PENDING"] as const) {
      const view = describeProtocolStatus(status);
      expect(view.tone).not.toBe("success");
      expect(isConsensusCleared(status)).toBe(false);
    }
  });

  it("only treats explicit consensus outcomes as cleared", () => {
    expect(isConsensusCleared("AUTHORIZED")).toBe(true);
    expect(isConsensusCleared("FINALIZED_SUCCESS")).toBe(true);
    expect(isConsensusCleared("REJECTED")).toBe(false);
  });
});
