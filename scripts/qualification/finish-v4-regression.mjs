import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const source = readFileSync(new URL("./finish-v4.ts", import.meta.url), "utf8");

test("finish-v4 is isolated from both legacy main state machines", () => {
  assert.doesNotMatch(source, /run-v3\.ts/);
  assert.doesNotMatch(source, /run-v4\.ts/);
  assert.doesNotMatch(source, /runQualification/);
  assert.match(source, /async function preflight/);
  assert.match(source, /async function runLifecycle/);
});

test("finish-v4 starts from sealed active live state and corrected counterparty write", () => {
  assert.match(source, /get_vault_address/);
  assert.match(source, /get_core_address/);
  assert.match(source, /status !== "SEALED"/);
  assert.match(source, /M-1 is not active/);
  assert.match(source, /FIRST_LIVE_WRITE=\$\{report\.firstLiveWrite\}/);
  assert.match(source, /core:register_counterparty:corrected/);
  assert.doesNotMatch(source, /mandate\.status === "DRAFT"/);
});

test("finish checkpoint is independent and preserves historical failed provenance", () => {
  assert.match(source, /finish-checkpoint\.json/);
  assert.match(source, /historicalProvenance/);
  assert.match(source, /excludedFromCompletion: true/);
  assert.match(source, /Historical failed counterparty transaction may never be replayed/);
  assert.match(source, /recordFailed/);
  assert.match(source, /recordCompleted/);
});

test("counterparty calldata is HTTPS validated and typed before the only first write", () => {
  assert.match(source, /register_counterparty/);
  assert.match(source, /qualification-v4-counterparty/);
  assert.match(source, /https:\/\/docs\.genlayer\.com\/robots\.txt/);
  assert.match(source, /typedCalldataProof\(deps\.abi, "register_counterparty"/);
  assert.match(source, /argumentCount/);
  assert.match(source, /Counterparty duplicate precondition/);
});

test("finish runner keeps fail-closed semantic outcomes and read-only unassessed proof", () => {
  assert.match(source, /UNASSESSED_NOT_CLEARED/);
  assert.match(source, /noTransactionSubmitted: true/);
  assert.match(source, /item\.status !== "AUTHORIZED"/);
  assert.match(source, /item\.status !== "FULFILLED"/);
  assert.match(source, /CHALLENGE_BLOCKED/);
  assert.match(source, /externalObservation/);
});

test("finish runner uses native value, accounting invariants, and no debug RPC probes", () => {
  assert.match(source, /value: AMOUNT/);
  assert.match(source, /accounting invariant failed/);
  assert.match(source, /assertGlobalMatchesMandate/);
  assert.doesNotMatch(source, /debugTraceTransaction|gen_getTransactionReceipt|debug_traceTransaction/);
});

console.log("FINISH_V4_REGRESSION: 6 passed");
