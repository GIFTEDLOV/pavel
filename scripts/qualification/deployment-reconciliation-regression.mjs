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

test("authoritative deployment address preserves backend address casing for live reads", () => {
  const address = "0x269966b007629e4eb6E55F8f96641A8735622c00";
  assert.equal(authoritativeDeploymentAddress({recipient: address}), address);
});

test("contract-unavailable reads retry after finalized deployment and accept delayed code", async () => {
  let calls = 0;
  const result = await deployedSourceParity({getContractCode: async () => { throw new Error("Contract not found"); }}, "0x1111111111111111111111111111111111111111", hash, 4, 0, "", async (_method, params) => { if (typeof params[0] === "object") throw new Error("Contract not found"); calls += 1; if (calls < 3) throw new Error("Contract not found"); return Buffer.from(code, "utf8").toString("base64"); });
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
  const result = await deployedSourceParity({getContractCode: async () => { throw new Error("Contract not found"); }}, "0x1111111111111111111111111111111111111111", hash, 1, 0, code, async () => { throw new Error("Contract not found"); });
  assert.equal(result.source, "FINALIZED_DEPLOY_TX_CODE_BYTES");
});

test("legacy string source lookup is accepted only after finalized lookup and preserves the exact address", async () => {
  const exactAddress = "0x269966b007629e4eb6E55F8f96641A8735622c00";
  const result = await deployedSourceParity({getContractCode: async () => { throw new Error("Contract not found"); }}, exactAddress, hash, 1, 0, "", async (_method, params) => {
    if (Array.isArray(params) && typeof params[0] === "object") throw new Error("legacy backend object-status defect");
    return Buffer.from(code, "utf8").toString("base64");
  });
  assert.equal(result.source, "FINALIZED_CONTRACT_CODE");
  assert.equal(result.address, exactAddress);
});

test("restart path reuses persisted deployment tx and records finalized pending source state", () => {
  assert.match(source, /let tx = existing\?\.tx/);
  assert.match(source, /status: "FINALIZED_PENDING_SOURCE"/);
  assert.match(source, /authoritativeDeploymentAddress\(result\.receipt\)/);
  assert.match(source, /if \(!tx\)/);
});
