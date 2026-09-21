import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";

const {inspectResults, QualificationRpcScheduler} = await import("./run-v3.ts");
const source = readFileSync(new URL("./run-v3.ts", import.meta.url), "utf8");

test("v3 separates consensus result 6 from execution result", () => {
  const observed = inspectResults({statusName: "FINALIZED", result: 6, txExecutionResultName: "FINISHED_WITH_RETURN"});
  assert.equal(observed.consensusResult, "MAJORITY_AGREE");
  assert.equal(observed.executionResult, "SUCCESS");
});

test("v3 preserves explicit execution errors", () => {
  const observed = inspectResults({statusName: "FINALIZED", result: 6, txExecutionResultName: "FINISHED_WITH_ERROR"});
  assert.equal(observed.consensusResult, "MAJORITY_AGREE");
  assert.equal(observed.executionResult, "ERROR");
});

test("v3 records unknown execution as unavailable for state fallback", () => {
  const observed = inspectResults({statusName: "FINALIZED", result: 6});
  assert.equal(observed.consensusResult, "MAJORITY_AGREE");
  assert.equal(observed.executionResult, "UNKNOWN");
  assert.equal(observed.executionResultSource, "unavailable");
});

test("v3 runner is address-bound, typed, checkpointed, and does not log secrets", () => {
  assert.match(source, /EXPECTED_SIGNER = "0xcb5a845638cbc1f95d7f8343278685682c3ba13f"/);
  assert.match(source, /new CalldataAddress/);
  assert.match(source, /saveState\(state\);/);
  assert.match(source, /getTransaction\(\{hash: tx\}\)/);
  assert.match(source, /signingSecret = ""/);
  const secretWords = ["pass", "word", "pri", "vate", "Key", "mn", "emonic"];
  assert.doesNotMatch(source, new RegExp(`console\\.log\\([^\\n]*(${secretWords.map((word) => word.replace(/[A-Z]/g, "[" + word.toLowerCase() + "]")).join("|")})`, "i"));
});

test("qualification RPC scheduler serializes more than thirty reads", async () => {
  const scheduler = new QualificationRpcScheduler({minSpacingMs: 1, maxReadAttempts: 1});
  let active = 0;
  let peak = 0;
  const calls = Array.from({length: 31}, (_, index) => scheduler.enqueue(`read-${index}`, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return index;
  }, true));
  const values = await Promise.all(calls);
  assert.deepEqual(values, Array.from({length: 31}, (_, index) => index));
  assert.equal(peak, 1);
  assert.equal(scheduler.snapshot().attempts, 31);
});

test("qualification RPC scheduler backs off bounded read-only 429s", async () => {
  const scheduler = new QualificationRpcScheduler({minSpacingMs: 0, backoffBaseMs: 1, maxReadAttempts: 3});
  let calls = 0;
  const value = await scheduler.enqueue("retryable-read", async () => {
    calls += 1;
    if (calls === 1) throw new Error("429 rate limit");
    return "ok";
  }, true);
  assert.equal(value, "ok");
  assert.equal(calls, 2);
  assert.equal(scheduler.snapshot().readRetries, 1);
});

test("qualification RPC scheduler never retries a write broadcast", async () => {
  const scheduler = new QualificationRpcScheduler({minSpacingMs: 0, backoffBaseMs: 1});
  let calls = 0;
  await assert.rejects(() => scheduler.enqueue("write", async () => {
    calls += 1;
    throw new Error("429 rate limit");
  }, false), /429 rate limit/);
  assert.equal(calls, 1);
  assert.equal(scheduler.snapshot().writeRetriesPrevented, 1);
});

test("v3 runner caches immutable schema and performs binding preflight before password", () => {
  assert.match(source, /qualification-schema-cache\.json/);
  assert.match(source, /prepareBindingPreflight/);
  assert.match(source, /nextUnfinishedWrite/);
  assert.match(source, /AWAITING_SECURE_KEYSTORE_PASSWORD/);
  assert.ok(source.indexOf("prepareBindingPreflight") < source.indexOf("AWAITING_SECURE_KEYSTORE_PASSWORD"));
});

test("v3 runner retains deployment checkpoints and excludes finalize helper records", () => {
  assert.match(source, /state\.steps\[\"deploy:core\"\]/);
  assert.match(source, /state\.steps\[\"deploy:vault\"\]/);
  assert.match(source, /startsWith\("finalize:"\)/);
  assert.match(source, /if \(!tx\)/);
});
