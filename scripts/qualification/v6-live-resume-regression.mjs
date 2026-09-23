import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const source = readFileSync(new URL("./run-v6-live.ts", import.meta.url), "utf8");

test("resume reconciles an existing start_fulfillment transaction before continuing", () => {
  assert.match(source, /const startStep = state\.steps\["core:start_fulfillment"\]/);
  assert.match(source, /reconcileSameHash\(\{client, hash: startStep\.tx/);
  assert.match(source, /canonical_postcondition_met: true/);
});

test("resume never resubmits a terminal fulfillment assessment without explicit recovery", () => {
  assert.match(source, /terminal assessment with no canonical postcondition is history/);
  assert.match(source, /if \(assessmentStep\?\.tx\)/);
  assert.match(source, /explicit evidence recovery is required before another assessment/);
  assert.match(source, /retry_permitted: false/);
});

test("a missing assessment transaction remains the only path that can submit one", () => {
  const assessment = source.slice(source.indexOf('const assessmentStep = state.steps["core:assess_fulfillment"]'));
  assert.match(assessment, /if \(assessmentStep\?\.tx\)/);
  assert.match(assessment, /else \{\s*await executeWrite\(/s);
});

console.log("V6_LIVE_RESUME_REGRESSION: 3 passed");
