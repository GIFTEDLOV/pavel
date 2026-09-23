import { describe, expect, it } from "vitest";
import { normalizeTransactionObservation } from "../lib/pavel/transaction-status";

describe("transaction state honesty", () => {
  it.each([
    [{}, "TX_ID_RECEIVED"],
    [{ statusName: "ACCEPTED" }, "ACCEPTED"],
    [{ statusName: "COMMITTING" }, "FINALIZING"],
    [{ statusName: "FINALIZED", resultName: "MAJORITY_AGREE", txExecutionResultName: "FINISHED_WITH_RETURN" }, "FINALIZED_SUCCESS"],
    [{ statusName: "FINALIZED", resultName: "MAJORITY_DISAGREE", txExecutionResultName: "FINISHED_WITH_RETURN" }, "FINALIZED_SUCCESS"],
    [{ statusName: "FINALIZED", txExecutionResultName: "ERROR" }, "FINALIZED_EXECUTION_FAILED"],
    [{ error: "RPC timeout" }, "AMBIGUOUS_POLLING"],
  ] as const)("maps %j to %s", (input, expected) => {
    expect(normalizeTransactionObservation(input)).toBe(expected);
  });

  it("does not treat final consensus status without a success result as success", () => {
    expect(normalizeTransactionObservation({ statusName: "FINALIZED" })).toBe("FINALIZED_EXECUTION_FAILED");
  });

  it("does not treat FINALIZED execution errors as success even when consensus agrees", () => {
    expect(normalizeTransactionObservation({ statusName: "FINALIZED", resultName: "MAJORITY_AGREE", txExecutionResultName: "FINISHED_WITH_ERROR" })).toBe("FINALIZED_EXECUTION_FAILED");
  });

  it("does not treat ACCEPTED execution return as durable UI success", () => {
    expect(normalizeTransactionObservation({ statusName: "ACCEPTED", resultName: "MAJORITY_AGREE", txExecutionResultName: "FINISHED_WITH_RETURN" })).toBe("ACCEPTED");
  });
});
