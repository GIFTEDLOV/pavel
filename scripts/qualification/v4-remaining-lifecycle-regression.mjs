import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const runnerSource = readFileSync(new URL("./run-v3.ts", import.meta.url), "utf8");
const preflightSource = readFileSync(new URL("./preflight-v4.ts", import.meta.url), "utf8");
const matrix = JSON.parse(readFileSync(new URL("./v4-qualification-constraint-matrix.json", import.meta.url), "utf8"));
const {runSimulation} = await import("./v4-lifecycle-simulation.mjs");

test("constraint matrix covers every remaining lifecycle phase", () => {
  const steps = new Set(matrix.remainingLifecycle.map((item) => item.step));
  for (const step of [
    "core:register_counterparty:corrected", "vault:deposit", "core:create_intent:positive",
    "core:authorize_intent", "vault:reserve:positive", "read-only:unassessed-proof",
    "core:assess_fulfillment", "core:get_settlement_instruction", "vault:request_release",
  ]) assert.equal(steps.has(step), true, `missing ${step}`);
  assert.match(matrix.accounting.perMandate, /available \+ reserved/);
});

test("local full lifecycle simulation proves accounting and external observation semantics", () => {
  const result = runSimulation();
  assert.equal(result.status, "PASS");
  assert.equal(result.noTransactionsSubmitted, true);
  assert.deepEqual(result.finalAccounting, {deposited: 1n, available: 0n, reserved: 0n, release_pending: 1n, refund_pending: 0n, recovered: 0n});
  assert.equal(result.externalObservation, "UNCONFIRMED");
});

test("runner preflights native value and postconditions for the exact positive flow", () => {
  assert.match(runnerSource, /functionName: "deposit"[^\n]+value: 1n/);
  assert.match(runnerSource, /Finalized deposit did not produce exactly one available smallest native GEN unit/);
  assert.match(runnerSource, /Positive reservation readback mismatch/);
  assert.match(runnerSource, /Positive fulfillment did not complete/);
  assert.match(runnerSource, /Vault release postcondition is not RELEASE_PENDING/);
});

test("runner uses chain-time gates and never wall-clock waits for lifecycle validity", () => {
  assert.match(runnerSource, /readChainTimeReference\(client, state/);
  assert.match(runnerSource, /waitForMandateActivation/);
  assert.match(runnerSource, /waitForSettlementReady/);
  assert.doesNotMatch(runnerSource, /while \(nowSeconds\(\) < Number\(fixture\.expiresAt\)\)/);
  assert.doesNotMatch(runnerSource, /WAITING_FOR_MANDATE_VALID_FROM/);
});

test("unassessed proof is read-only and no longer creates a deliberate live negative Intent", () => {
  assert.match(runnerSource, /proveUnassessedReadOnly\(client, core, "I-2"\)/);
  assert.doesNotMatch(runnerSource, /functionName: "create_intent"[^\n]+I-2/);
  assert.doesNotMatch(runnerSource, /functionName: "vault:reserve:negative"/);
  assert.match(preflightSource, /noTransactionSubmitted: true/);
});

test("dynamic semantic outcomes are fail-closed before settlement", () => {
  assert.match(runnerSource, /intent.status !== "AUTHORIZED"/);
  assert.match(runnerSource, /intent.status !== "FULFILLED"/);
  assert.match(runnerSource, /CHALLENGE_BLOCKED/);
  assert.match(runnerSource, /externalObservation.*UNCONFIRMED|UNCONFIRMED/);
});

test("V4 wrapper invokes comprehensive preflight before importing the signer runner", () => {
  const wrapperSource = readFileSync(new URL("./run-v4.ts", import.meta.url), "utf8");
  const gate = wrapperSource.indexOf("preflight-v4.ts");
  const runnerImport = wrapperSource.indexOf("await import(\"./run-v3.ts\")");
  assert.ok(gate >= 0 && gate < runnerImport);
  assert.match(wrapperSource, /execFileSync/);
});

console.log("QUALIFICATION_V4_REMAINING_LIFECYCLE_REGRESSION: 7 passed");
