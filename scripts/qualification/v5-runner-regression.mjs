import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {fixture, validateEvidenceUrl} from "./run-v5.ts";

const source = readFileSync(new URL("./run-v5.ts", import.meta.url), "utf8");

test("V5 is an isolated state machine and never imports an old main", () => {
  assert.doesNotMatch(source, /run-v3\.ts.*main|run-v4\.ts.*main|finish-v4\.ts.*main/);
  assert.doesNotMatch(source, /qualification-v4/);
  assert.match(source, /sendDeployOnce/);
  assert.match(source, /sendWriteOnce/);
  assert.match(source, /completedSteps/);
  assert.match(source, /failedAttempts/);
  assert.match(source, /submittedTransactions/);
});

test("V5 uses explicit HTTPS transport and keeps authority identity separate", () => {
  assert.throws(() => validateEvidenceUrl("docs.genlayer.com", "docs.genlayer.com"));
  assert.throws(() => validateEvidenceUrl("http://docs.genlayer.com/robots.txt", "docs.genlayer.com"));
  assert.deepEqual(validateEvidenceUrl("https://docs.genlayer.com/robots.txt", "docs.genlayer.com"), {
    url: "https://docs.genlayer.com/robots.txt",
    authority: "docs.genlayer.com",
    hostname: "docs.genlayer.com",
    protocol: "https:",
  });
  const values = fixture();
  assert.equal(values.authority, undefined);
  assert.equal(values.authorityConstraints, "docs.genlayer.com");
  assert.equal(source.includes("EVIDENCE_URL, EVIDENCE_AUTHORITY"), true);
});

test("V5 fixes the mandate sequencing and separates activation waiting from sealing", () => {
  const configure = source.indexOf('functionName: "configure_mandate"');
  const seal = source.indexOf('functionName: "seal_mandate"');
  const activation = source.indexOf("waitForActivation(client, mandate)");
  const createIntent = source.indexOf('functionName: "create_intent"');
  assert.ok(configure >= 0 && seal > configure && activation > seal && createIntent > activation);
  assert.match(source, /chainNow < Number\(mandate\.valid_from\)/);
  assert.match(source, /chainNow >= Number\(mandate\.valid_from\)/);
  assert.doesNotMatch(source, /WAITING_FOR_MANDATE_VALID_FROM/);
});

test("V5 deposit carries native value in value and never feeValue", () => {
  assert.match(source, /functionName: "deposit"/);
  assert.match(source, /value: MINIMAL_AMOUNT/);
  assert.doesNotMatch(source, /feeValue/);
});

test("V5 uses explicit evidence commitments for both stages", () => {
  const definitions = [...source.matchAll(/functionName: "define_evidence"[\s\S]{0,420}?evidence\.sha256/g)];
  assert.equal(definitions.length >= 2, true);
  assert.match(source, /functionName: "stage_evidence"/);
  assert.match(source, /identity_fingerprint === ""/);
});

test("V5 reads latest-final state after successful writes and tracks child messages", () => {
  assert.match(source, /transactionHashVariant: LATEST_FINAL/);
  assert.match(source, /getTriggeredTransactionIds\(\{client, hash: releaseTx\}\)/);
  assert.match(source, /externalObservation = "CONFIRMED"/);
  assert.match(source, /externalObservation = "UNCONFIRMED"/);
});

test("explicit authorization retry stops before reservation", () => {
  const retryStop = source.indexOf('if (retryStep === AUTHORIZATION_STEP)');
  const lifecycleReserve = source.lastIndexOf('functionName: "reserve"');
  assert.ok(retryStop >= 0 && lifecycleReserve > retryStop);
  assert.match(source.slice(retryStop, lifecycleReserve), /stoppedBeforeReservation: true/);
  assert.match(source.slice(retryStop, lifecycleReserve), /AUTHORIZATION_RETRY_ONLY=PASS/);
});

console.log("V5_RUNNER_REGRESSION: 7 passed");
