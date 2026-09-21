import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";

const {inspectResults} = await import("./run-v3.ts");
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
