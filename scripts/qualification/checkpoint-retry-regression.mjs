import assert from "node:assert/strict";
import {test} from "node:test";
import {
  AUTHORIZATION_STEP,
  EARLIER_LIFECYCLE_STEPS,
  appendAuthorizationAttempt,
  assertRetryPlan,
  authorizationAttempts,
  authorizationRetryDecision,
  ensureAuthorizationCheckpoint,
  parseRetryStep,
} from "./lib/checkpoint-retry.ts";

const TX_1 = "0xb9e77bde4d7856a3f218ae7c58bcff2fb110b43dc590f6fa179aefe2def91511";
const TX_2 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function stateWith(step = {}) {
  const steps = Object.fromEntries(EARLIER_LIFECYCLE_STEPS.map((label) => [label, {label, status: "COMPLETE"}]));
  steps[AUTHORIZATION_STEP] = {label: AUTHORIZATION_STEP, tx: TX_1, terminal_status: "FINALIZED", execution: "FINISHED_WITH_RETURN", execution_success: true, consensus_result: "MAJORITY_DISAGREE", canonical_postcondition_met: false, retry_permitted: true, attempt_number: 1, ...step};
  return {steps, authorization: {attempts: [{attempt: 1, tx: TX_1, status: "FINALIZED", execution: "FINISHED_WITH_RETURN", consensus: "MAJORITY_DISAGREE", execution_success: true, canonical_commit: false, retry_permitted: true}]}, authorizationResubmissions: 0};
}

test("A: canonical postcondition success never resubmits", () => {
  const state = stateWith({canonical_postcondition_met: true});
  assert.equal(authorizationRetryDecision(state.steps[AUTHORIZATION_STEP], true), "NO_RESUBMIT_CANONICAL");
  assert.throws(() => assertRetryPlan(state, AUTHORIZATION_STEP), /canonical postcondition success/);
});

test("B: nonterminal existing transaction is reconciled only", () => {
  const step = stateWith({terminal_status: "SUBMITTED"}).steps[AUTHORIZATION_STEP];
  assert.equal(authorizationRetryDecision(step, true), "RECONCILE_SAME_TX");
});

test("C: terminal missing postcondition stops without an explicit retry", () => {
  const step = stateWith().steps[AUTHORIZATION_STEP];
  assert.equal(authorizationRetryDecision(step, false), "STOP_EXPLICIT_RETRY_REQUIRED");
});

test("D: explicit retry authorizes exactly one new write", () => {
  const state = stateWith();
  assert.deepEqual(parseRetryStep(["node", "run-v5.ts", "--retry-step", AUTHORIZATION_STEP]), AUTHORIZATION_STEP);
  assert.equal(authorizationRetryDecision(state.steps[AUTHORIZATION_STEP], true), "SUBMIT_ONE_NEW_ATTEMPT");
  assert.equal(assertRetryPlan(state, AUTHORIZATION_STEP).attemptNumber, 2);
});

test("E: attempt 2 is appended and attempt 1 remains intact", () => {
  const state = stateWith();
  appendAuthorizationAttempt(state, {attempt: 2, tx: TX_2, status: "SUBMITTED", execution: "PENDING", consensus: "UNAVAILABLE", execution_success: false, canonical_commit: false, retry_permitted: false});
  assert.deepEqual(authorizationAttempts(state).map((item) => item.tx), [TX_1, TX_2]);
  assert.equal(state.steps[AUTHORIZATION_STEP].tx, TX_2);
  assert.equal(state.authorizationResubmissions, 1);
});

test("F: retry control refuses to replay an earlier lifecycle write", () => {
  const state = stateWith();
  state.steps[EARLIER_LIFECYCLE_STEPS[0]].status = "ERROR";
  assert.throws(() => assertRetryPlan(state, AUTHORIZATION_STEP), /replay earlier lifecycle writes/);
});

test("G: restart reconciliation targets the latest attempt", () => {
  const state = stateWith();
  appendAuthorizationAttempt(state, {attempt: 2, tx: TX_2, status: "FINALIZED", execution: "FINISHED_WITH_RETURN", consensus: "MAJORITY_DISAGREE", execution_success: true, canonical_commit: false, retry_permitted: true});
  ensureAuthorizationCheckpoint(state);
  assert.equal(state.steps[AUTHORIZATION_STEP].tx, TX_2);
  assert.equal(state.steps[AUTHORIZATION_STEP].attempt_number, 2);
  assert.equal(authorizationRetryDecision(state.steps[AUTHORIZATION_STEP], false), "STOP_EXPLICIT_RETRY_REQUIRED");
});

test("H: a used retry cannot create an automatic third attempt", () => {
  const step = stateWith({attempt_number: 2, tx: TX_2}).steps[AUTHORIZATION_STEP];
  assert.equal(authorizationRetryDecision(step, false), "STOP_EXPLICIT_RETRY_REQUIRED");
  assert.equal(authorizationRetryDecision(step, true, true), "NO_THIRD_ATTEMPT");
});

console.log("CHECKPOINT_RETRY_REGRESSION: 8 passed");
