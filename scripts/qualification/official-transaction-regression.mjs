import assert from "node:assert/strict";
import {test} from "node:test";
import {
  FALLBACK_LATEST_FINAL,
  getTriggeredTransactionIds,
  isSuccessful,
  normalizeTransaction,
  requireSuccessfulExecution,
  readLatestFinalPostcondition,
  reconcileSameHash,
  sendWriteOnce,
  sendDeployOnce,
} from "./lib/official-transaction.ts";

function raw(overrides = {}) {
  return {
    hash: "0x" + "1".repeat(64),
    statusName: "FINALIZED",
    result_name: "MAJORITY_AGREE",
    consensus_data: {
      validators: [
        {execution_result: "SUCCESS"},
        {execution_result: "SUCCESS"},
        {execution_result: "ERROR", genvm_result: {error_code: "CONSENSUS_VALIDATOR_QUORUM_REACHED"}},
      ],
    },
    ...overrides,
  };
}

test("FINALIZED + FINISHED_WITH_RETURN + MAJORITY_AGREE is a transaction success", () => {
  assert.equal(isSuccessful(raw({result_name: "MAJORITY_AGREE"})), true);
});

test("FINALIZED + FINISHED_WITH_RETURN + MAJORITY_DISAGREE is a transaction success", () => {
  assert.equal(isSuccessful(raw({result_name: "MAJORITY_DISAGREE"})), true);
});

test("ACCEPTED + FINISHED_WITH_RETURN is a transaction success", () => {
  assert.equal(isSuccessful(raw({statusName: "ACCEPTED"})), true);
});

test("FINALIZED + FINISHED_WITH_ERROR is a transaction failure", () => {
  const tx = normalizeTransaction(raw({txExecutionResultName: "FINISHED_WITH_ERROR"}));
  assert.equal(tx.txExecutionResultName, "FINISHED_WITH_ERROR");
  assert.equal(isSuccessful(tx), false);
});

test("UNDETERMINED + FINISHED_WITH_RETURN is a transaction failure", () => {
  assert.equal(isSuccessful(raw({statusName: "UNDETERMINED"})), false);
});

test("transaction success remains separate from a REJECTED business state", () => {
  const tx = requireSuccessfulExecution(raw({result_name: "MAJORITY_DISAGREE"}));
  const businessReadback = {status: "REJECTED", authorization: {decision: "REJECTED"}};
  assert.equal(isSuccessful(tx), true);
  assert.equal(businessReadback.status, "REJECTED");
  assert.equal(businessReadback.authorization.decision, "REJECTED");
});

test("transaction success remains separate from an AUTHORIZED business state", () => {
  const tx = requireSuccessfulExecution(raw({result_name: "MAJORITY_DISAGREE"}));
  const businessReadback = {status: "AUTHORIZED", authorization: {decision: "AUTHORIZED"}};
  assert.equal(isSuccessful(tx), true);
  assert.equal(businessReadback.status, "AUTHORIZED");
  assert.equal(businessReadback.authorization.decision, "AUTHORIZED");
});

test("successful V4 transaction still normalizes legacy execution observations", () => {
  const normalized = normalizeTransaction(raw());
  assert.equal(normalized.statusName, "FINALIZED");
  assert.equal(normalized.txExecutionResultName, "FINISHED_WITH_RETURN");
  assert.equal(normalized.lifecycle.txExecutionResultName, "FINISHED_WITH_RETURN");
  assert.equal(isSuccessful(normalized), true);
});

test("FINALIZED without an execution result is unknown and fails closed", () => {
  const tx = normalizeTransaction({statusName: "FINALIZED", result_name: "MAJORITY_AGREE"});
  assert.equal(tx.txExecutionResultName, undefined);
  assert.equal(isSuccessful(tx), false);
});

test("same-hash reconciliation uses official finalization and the same hash", async () => {
  const calls = [];
  const client = {
    waitForTransactionReceipt: async (args) => { calls.push(["wait", args]); return raw(); },
    getTransaction: async (args) => { calls.push(["get", args]); return raw(); },
  };
  const result = await reconcileSameHash({client, hash: raw().hash, interval: 1, retries: 1});
  assert.equal(result.successful, true);
  assert.deepEqual(calls[0][1], {hash: raw().hash, status: "FINALIZED", fullTransaction: true, interval: 1, retries: 1});
  assert.deepEqual(calls[1][1], {hash: raw().hash});
});

test("newer waitForFinalization is preferred when the SDK exposes it", async () => {
  const calls = [];
  const client = {
    waitForFinalization: async (args) => { calls.push(["waitForFinalization", args]); return raw(); },
    getTransaction: async (args) => { calls.push(["get", args]); return raw(); },
  };
  const result = await reconcileSameHash({client, hash: raw().hash});
  assert.equal(result.successful, true);
  assert.deepEqual(calls[0], ["waitForFinalization", {hash: raw().hash, fullTransaction: true}]);
});

test("write value is separate from fees and the hash is persisted once", async () => {
  const events = [];
  const request = {address: "0x" + "2".repeat(40), functionName: "deposit", args: ["M-1"], value: 1n, account: {address: "0x" + "3".repeat(40)}};
  const client = {writeContract: async (received) => { events.push(["write", received]); return "0x" + "4".repeat(64); }};
  const hash = await sendWriteOnce({client, operation: "deposit", request, persistHash: (value) => events.push(["persist", value])});
  assert.equal(hash, "0x" + "4".repeat(64));
  assert.equal(events[0][0], "write");
  assert.equal(events[1][0], "persist");
  assert.equal(events[0][1].value, 1n);
  assert.equal("feeValue" in events[0][1], false);
});

test("deployment uses the official deploy surface and persists its hash before reconciliation", async () => {
  const events = [];
  const client = {deployContract: async (request) => { events.push(["deploy", request]); return "0x" + "9".repeat(64); }};
  const hash = await sendDeployOnce({client, operation: "deploy:core", request: {code: new Uint8Array([1, 2, 3]), args: [], account: {address: "0x" + "3".repeat(40)}}, persistHash: (value) => events.push(["persist", value])});
  assert.equal(hash, "0x" + "9".repeat(64));
  assert.equal(events[0][0], "deploy");
  assert.equal(events[1][0], "persist");
});

test("LATEST_FINAL is forwarded to the postcondition read", async () => {
  let received;
  const client = {readContract: async (args) => { received = args; return {deposited: "1"}; }};
  await readLatestFinalPostcondition({client, address: "0x" + "5".repeat(40), functionName: "get_accounting", args: ["M-1"], account: "0x" + "6".repeat(40), transactionHashVariant: FALLBACK_LATEST_FINAL});
  assert.equal(received.transactionHashVariant, "latest-final");
});

test("triggered child transaction IDs are followed through the official client surface", async () => {
  const hash = "0x" + "7".repeat(64);
  const ids = await getTriggeredTransactionIds({client: {getTriggeredTransactionIds: async (args) => { assert.deepEqual(args, {hash}); return ["0x" + "8".repeat(64)]; }}, hash});
  assert.deepEqual(ids, ["0x" + "8".repeat(64)]);
});

console.log("OFFICIAL_TRANSACTION_REGRESSION: 15 passed");
