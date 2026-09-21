import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";

const {authoritativeDeploymentAddress, contractCodeFromFinalizedReceipt, deployedSourceParity, inspectResults} = await import("./run-v3.ts");
const source = readFileSync(new URL("./run-v3.ts", import.meta.url), "utf8");
const code = "# finalized deployment source\n";
const hash = createHash("sha256").update(Buffer.from(code, "utf8")).digest("hex");

test("deployment address prefers finalized txDataDecoded contractAddress over recipient", () => {
  assert.equal(authoritativeDeploymentAddress({txDataDecoded: {contractAddress: "0x1111111111111111111111111111111111111111"}, recipient: "0x2222222222222222222222222222222222222222"}), "0x1111111111111111111111111111111111111111");
});

test("contract-unavailable reads retry after finalized deployment and accept delayed code", async () => {
  let calls = 0;
  const result = await deployedSourceParity({getContractCode: async () => { calls += 1; if (calls < 3) throw new Error("Contract not found"); return code; }}, "0x1111111111111111111111111111111111111111", hash, 4, 0);
  assert.equal(result.exact, true);
  assert.equal(result.attempts, 3);
});

test("deployment read failures never convert an explicit execution error into a retry", () => {
  const result = inspectResults({statusName: "FINALIZED", result: 6, txExecutionResultName: "FINISHED_WITH_ERROR"});
  assert.equal(result.executionResult, "ERROR");
});

test("finalized transaction contract_code is a source-parity fallback after bounded RPC lag", async () => {
  const encoded = Buffer.from(code, "utf8").toString("base64");
  assert.equal(contractCodeFromFinalizedReceipt({data: {contract_code: encoded}}), code);
  const result = await deployedSourceParity({getContractCode: async () => { throw new Error("Contract not found"); }}, "0x1111111111111111111111111111111111111111", hash, 1, 0, code);
  assert.equal(result.source, "finalized_transaction.contract_code_after_gen_getContractCode_lag");
});

test("restart path reuses persisted deployment tx and records finalized pending source state", () => {
  assert.match(source, /let tx = existing\?\.tx/);
  assert.match(source, /status: "FINALIZED_PENDING_SOURCE"/);
  assert.match(source, /authoritativeDeploymentAddress\(result\.receipt\)/);
  assert.match(source, /if \(!tx\)/);
});
