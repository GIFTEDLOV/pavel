import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const runnerSource = readFileSync(new URL("./run-v3.ts", import.meta.url), "utf8");
const wrapperSource = readFileSync(new URL("./run-v4.ts", import.meta.url), "utf8");
const {
  deriveJustInTimeValidity,
  CAN_SEAL,
  CAN_USE_ACTIVE_MANDATE,
  minimumSafeSealMargin,
  assertSealWindowOpen,
  checkpointHasCompletedSuccess,
  checkpointHasFailedAttempt,
  rpcCapabilityStatus,
  cacheUnsupportedRpcCapability,
} = await import("./run-v3.ts");

test("valid_from in future plus immediate seal submits before activation", () => {
  const mandate = {valid_from: "2000", expires_at: "4000", status: "DRAFT"};
  assert.equal(CAN_SEAL(mandate, 1500), true);
  assert.doesNotThrow(() => assertSealWindowOpen(mandate, 1500, 90));
  assert.doesNotThrow(() => deriveJustInTimeValidity(1000, 42, 900, 1800));
  assert.equal(runnerSource.includes("WAITING_FOR_MANDATE_VALID_FROM"), false);
  assert.equal(runnerSource.includes("while (nowSeconds() < Number(fixture.validFrom))"), false);
});

test("runner never waits for activation before sealing", () => {
  const draftFlow = runnerSource.slice(runnerSource.indexOf('if (mandate.status === "DRAFT")'), runnerSource.indexOf('assertMandate(mandate, fixture, "SEALED")'));
  assert.doesNotMatch(draftFlow, /WAITING_FOR_MANDATE_ACTIVATION/);
  assert.match(draftFlow, /functionName: "seal_mandate"/);
  assert.match(runnerSource, /waitForMandateActivation\(client, state, mandate/);
});

test("after successful seal the runner waits for activation", () => {
  const sealCompletion = runnerSource.indexOf('assertMandate(mandate, fixture, "SEALED")');
  const activationWait = runnerSource.indexOf("waitForMandateActivation(client, state, mandate", sealCompletion);
  assert.ok(sealCompletion >= 0 && activationWait > sealCompletion);
  assert.match(runnerSource, /CAN_USE_ACTIVE_MANDATE/);
});

test("configure finalization that exhausts the margin reconfigures instead of attempting seal", () => {
  const derived = deriveJustInTimeValidity(1000, 42, 900, 1800);
  const minimum = minimumSafeSealMargin(42);
  assert.ok(derived.validFrom > 1000);
  assert.ok(minimum >= 90);
  assert.throws(() => assertSealWindowOpen({valid_from: "1050", expires_at: "2000"}, 1000, minimum), /safety margin/);
  assert.match(runnerSource, /RECOVERY_\$\{nextAttempt\}_MARGIN_RECONFIGURE/);
  assert.match(runnerSource, /functionName: "configure_mandate"/);
  assert.match(runnerSource, /functionName: "seal_mandate"/);
});

test("failed seal remains historical and never satisfies completion", () => {
  const failed = {steps: {"core:seal_mandate:recovery": {status: "ERROR", tx: "0xfailed"}}, completedSteps: {}, failedAttempts: [{label: "core:seal_mandate:recovery", status: "ERROR", tx: "0xfailed"}]};
  assert.equal(checkpointHasCompletedSuccess(failed, "core:seal_mandate:recovery"), false);
  assert.equal(checkpointHasFailedAttempt(failed, "core:seal_mandate:recovery"), true);
  assert.match(runnerSource, /recordFailed\(state/);
  assert.match(runnerSource, /recordCompleted\(state/);
});

test("restart after successful configure reconciles the existing configure hash", () => {
  assert.match(runnerSource, /reconcileExistingCompletedReadOnly/);
  assert.match(runnerSource, /resume:\$\{step\.tx\}:status/);
  assert.match(runnerSource, /configuredRecovery\?\.tx/);
});

test("restart after failed seal never resubmits that same transaction", () => {
  assert.match(runnerSource, /state\.failedAttempts\.some\(\(attempt\) => attempt\.tx === tx\)/);
  assert.match(runnerSource, /Checkpoint contains explicit failed transaction/);
  assert.match(runnerSource, /core:configure_mandate:recovery-\$\{attempt\}/);
  assert.match(runnerSource, /core:seal_mandate:recovery-\$\{attempt\}/);
});

test("unsupported debug RPC methods are capability-cached", () => {
  for (const method of ["gen_getTransactionReceipt", "gen_dbg_traceTransaction", "debug_traceTransaction"]) assert.ok(runnerSource.includes(method));
  assert.match(runnerSource, /rpc-capability-cache\.json/);
  assert.match(runnerSource, /cacheUnsupportedRpcCapability/);
  assert.match(runnerSource, /cachedUnsupported/);
  for (const method of ["gen_getTransactionReceipt", "gen_dbg_traceTransaction", "debug_traceTransaction"]) cacheUnsupportedRpcCapability(method, new Error("Method not found"));
  const statuses = ["gen_getTransactionReceipt", "gen_dbg_traceTransaction", "debug_traceTransaction"].map(rpcCapabilityStatus);
  assert.ok(statuses.every((status) => status.cachedUnsupported === true));
});

test("CAN_SEAL and CAN_USE_ACTIVE_MANDATE are distinct predicates", () => {
  const mandate = {valid_from: "1000", expires_at: "2000"};
  assert.equal(CAN_SEAL(mandate, 999), true);
  assert.equal(CAN_USE_ACTIVE_MANDATE(mandate, 999), false);
  assert.equal(CAN_SEAL(mandate, 1000), false);
  assert.equal(CAN_USE_ACTIVE_MANDATE(mandate, 1000), true);
  assert.equal(CAN_USE_ACTIVE_MANDATE(mandate, 2000), false);
});

test("V4 wrapper resumes the existing pair without deployment or new version", () => {
  assert.match(wrapperSource, /qualification-v4/);
  assert.match(wrapperSource, /checkpoint\.json/);
  assert.match(wrapperSource, /transaction-ledger\.json/);
  assert.doesNotMatch(wrapperSource, /deployContract/);
  assert.doesNotMatch(wrapperSource, /qualification-v5/);
});

console.log("QUALIFICATION_V4_RUNNER_REGRESSION: 10 passed");
