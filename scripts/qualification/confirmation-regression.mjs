import assert from "node:assert/strict";
import test from "node:test";
import {requestSubmissionConfirmation} from "./create-root-mandate.ts";

test("decline exits without signing or broadcast", async () => {
  const questions = [];
  let proceeded = 0;
  const result = await requestSubmissionConfirmation(async (input) => {
    questions.push(input);
    return {submit: false};
  }, async () => {
    proceeded += 1;
  });
  assert.equal(result.confirmed, false);
  assert.equal(proceeded, 0);
  assert.equal(questions.length, 1);
  assert.equal(questions[0][0].type, "confirm");
  assert.equal(questions[0][0].name, "submit");
});

test("accept proceeds exactly to the signing stage", async () => {
  let proceeded = 0;
  const result = await requestSubmissionConfirmation(async (questions) => {
    assert.equal(questions[0].type, "confirm");
    return {submit: true};
  }, async () => {
    proceeded += 1;
  });
  assert.equal(result.confirmed, true);
  assert.equal(result.proceeded, true);
  assert.equal(proceeded, 1);
});

test("password/signing stage is unreachable before confirmation", async () => {
  const promptNames = [];
  let signingStageReached = false;
  const result = await requestSubmissionConfirmation(async (questions) => {
    promptNames.push(questions[0].name);
    return {submit: false};
  }, async () => {
    signingStageReached = true;
    promptNames.push("password");
  });
  assert.equal(result.confirmed, false);
  assert.equal(signingStageReached, false);
  assert.deepEqual(promptNames, ["submit"]);
});

test("confirmation UI failure produces no write", async () => {
  let proceeded = 0;
  const result = await requestSubmissionConfirmation(async () => {
    throw new Error("simulated confirmation UI failure");
  }, async () => {
    proceeded += 1;
  });
  assert.equal(result.confirmed, false);
  assert.equal(result.proceeded, false);
  assert.equal(proceeded, 0);
});
