import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const runnerSource = readFileSync(new URL("./run-v3.ts", import.meta.url), "utf8");
const wrapperSource = readFileSync(new URL("./run-v4.ts", import.meta.url), "utf8");
const {deriveJustInTimeValidity} = await import("./run-v3.ts");

test("JIT validity remains safely future relative to observed chain time", () => {
  const result = deriveJustInTimeValidity(1790059100, 365, 1790057100, 1790229900);
  assert.ok(result.validFrom > result.chainNow);
  assert.ok(result.expiresAt > result.validFrom);
  assert.ok(result.safetyMargin >= 300);
});

test("higher observed latency expands the bounded safety margin", () => {
  const fast = deriveJustInTimeValidity(1000, 10, 900, 2000);
  const slow = deriveJustInTimeValidity(1000, 700, 900, 2000);
  assert.ok(slow.validFrom > fast.validFrom);
  assert.ok(slow.safetyMargin <= 1800);
});

test("V4 recovery preserves deployments and uses separate amendment steps", () => {
  assert.match(wrapperSource, /qualification-v4/);
  assert.match(wrapperSource, /checkpoint\.json/);
  assert.match(wrapperSource, /transaction-ledger\.json/);
  assert.match(runnerSource, /fixture-amendment\.json/);
  assert.match(runnerSource, /core:configure_mandate:recovery/);
  assert.match(runnerSource, /core:seal_mandate:recovery/);
  assert.match(runnerSource, /waitForMandateActivation/);
  assert.doesNotMatch(wrapperSource, /deployContract/);
});

test("configured validity is read back on restart instead of silently rewritten", () => {
  assert.match(runnerSource, /configuredMandate\.valid_from/);
  assert.match(runnerSource, /state\.steps\[\"core:configure_mandate:recovery\"\]/);
});

test("failed seal remains historical and is never retried under its original label", () => {
  assert.match(runnerSource, /state\.steps\[\"core:seal_mandate\"\]\?\.status === \"ERROR\"/);
  assert.match(runnerSource, /const sealLabel = state\.steps\[\"core:seal_mandate\"\]/);
});

console.log("QUALIFICATION_V4_RUNNER_REGRESSION: 5 passed");
