import assert from "node:assert/strict";
import test from "node:test";

const {inspectTransactionResults, resolveFinalizedOutcome} = await import("./run-v2.ts");

const finalized = (extra = {}) => ({statusName: "FINALIZED", ...extra});

test("FINALIZED + explicit SUCCESS is classified from execution metadata", () => {
  const receipt = finalized({result: 6, txExecutionResultName: "FINISHED_WITH_RETURN"});
  const observed = inspectTransactionResults(receipt);
  assert.equal(observed.consensusResult, "MAJORITY_AGREE");
  assert.equal(observed.executionResult, "SUCCESS");
  assert.equal(observed.executionResultSource, "txExecutionResultName");
  assert.equal(resolveFinalizedOutcome(receipt, false), "SUCCESS");
});

test("FINALIZED + explicit ERROR stops", () => {
  const receipt = finalized({result: 6, txExecutionResultName: "FINISHED_WITH_ERROR"});
  const observed = inspectTransactionResults(receipt);
  assert.equal(observed.consensusResult, "MAJORITY_AGREE");
  assert.equal(observed.executionResult, "ERROR");
  assert.equal(resolveFinalizedOutcome(receipt, true), "ERROR");
});

test("FINALIZED + UNKNOWN + expected state mutation is proven by state", () => {
  const receipt = finalized({result: 6});
  const observed = inspectTransactionResults(receipt);
  assert.equal(observed.consensusResult, "MAJORITY_AGREE");
  assert.equal(observed.executionResult, "UNKNOWN");
  assert.equal(resolveFinalizedOutcome(receipt, true), "SUCCESS_PROVEN_BY_STATE");
});

test("FINALIZED + UNKNOWN + no state mutation fails closed", () => {
  const receipt = finalized({result: 6});
  assert.equal(resolveFinalizedOutcome(receipt, false), "UNKNOWN_OR_FAILED");
});
