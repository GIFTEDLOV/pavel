import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {AUTHORIZATION_V6_FIELDS, AUTHORIZATION_V6_SCHEMA, canonicalAuthorizedV6} from "./lib/authorization-v6.ts";

const core = readFileSync(new URL("../../contracts/pavel_core.py", import.meta.url), "utf8");
const vault = readFileSync(new URL("../../contracts/pavel_vault.py", import.meta.url), "utf8");
const checkpoint = readFileSync(new URL("./lib/checkpoint-retry.ts", import.meta.url), "utf8");

const semanticFields = [
  "purpose_aligned",
  "activity_permitted",
  "prohibited_activity_absent",
  "counterparty_scope_satisfied",
  "deliverable_in_scope",
  "commercial_terms_consistent",
  "evidence_semantically_sufficient",
  "duplicate_semantic_purchase_absent",
  "authority_scope_preserved",
  "fulfillment_terms_defined",
  "external_dependencies_disclosed",
  "constitution_satisfied",
];

const keyBlock = core.match(/AUTHORIZATION_V2_KEYS = \(([^)]*)\)/s)?.[1] ?? "";
const sourceKeys = [...keyBlock.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
const authorizeBlock = core.match(/def authorize_intent\(.*?(?=\n    # ---------- fulfillment)/s)?.[0] ?? "";

test("V6 authorization schema is exactly one schema key plus twelve booleans", () => {
  assert.deepEqual(sourceKeys, ["schema", ...semanticFields]);
  assert.deepEqual([...AUTHORIZATION_V6_FIELDS], semanticFields);
  assert.equal(sourceKeys.length, 13);
  assert.match(core, /AUTHORIZATION_V2_SCHEMA = "pavel-authorization-v2"/);
  assert.match(core, /AUTHORIZATION_PROMPT_KEYS = AUTHORIZATION_V2_KEYS/);
  assert.match(core, /AUTHORIZATION_VALIDATOR_KEYS = AUTHORIZATION_V2_KEYS/);
});

test("V6 authorization consensus contains no free-form explanation", () => {
  assert.match(authorizeBlock, /Use EXACTLY these 13 keys and no others/);
  assert.match(authorizeBlock, /Do not return reasoning or free-form text/);
  assert.match(authorizeBlock, /DO NOT use Markdown code fences/);
  assert.match(authorizeBlock, /DO NOT include prose before or after the JSON object/);
  assert.doesNotMatch(authorizeBlock, /explanation MUST|bounded explanation/);
  assert.match(authorizeBlock, /for field in SEMANTIC_AUTH_FIELDS/);
  assert.match(authorizeBlock, /proposed\[field\] != independent\[field\]/);
});

test("V6 derives canonical decision and reasons deterministically", () => {
  assert.match(authorizeBlock, /failed_checks = \[\]/);
  assert.match(authorizeBlock, /failed_checks\.append\(field\)/);
  assert.match(authorizeBlock, /decision = len\(failed_checks\) == 0/);
  assert.match(authorizeBlock, /AUTHORIZED_ALL_CHECKS_PASSED/);
  assert.match(authorizeBlock, /AUTHORIZATION_CHECKS_FAILED/);
  assert.match(authorizeBlock, /"vector": boolean_vector/);
});

test("V6 keeps malformed output fail-closed", () => {
  const validator = core.match(/def _auth_valid\(.*?(?=\n    @gl\.public\.write)/s)?.[0] ?? "";
  assert.match(validator, /len\(result\) != len\(AUTHORIZATION_VALIDATOR_KEYS\)/);
  assert.match(validator, /result\.get\("schema"\) != AUTHORIZATION_V2_SCHEMA/);
  assert.match(validator, /not isinstance\(result\[field\], bool\)/);
  assert.match(authorizeBlock, /AUTHORIZATION_RETRY_REQUIRED/);
});

test("V6 keeps Core/Vault binding immutable and checkpoint retries explicit", () => {
  assert.match(core, /not self\.vault_bound/);
  assert.match(vault, /not self\.core_bound/);
  assert.match(checkpoint, /STOP_EXPLICIT_RETRY_REQUIRED/);
  assert.match(checkpoint, /SUBMIT_ONE_NEW_ATTEMPT/);
  assert.match(checkpoint, /NO_THIRD_ATTEMPT/);
});

test("V6 continuation requires canonical authorization vector before reserve", () => {
  const vector = Object.fromEntries(AUTHORIZATION_V6_FIELDS.map((field) => [field, true]));
  const item = {status: "AUTHORIZED", authorization: {schema: AUTHORIZATION_V6_SCHEMA, decision: "AUTHORIZED", reason_code: "AUTHORIZED_ALL_CHECKS_PASSED", failed_checks: [], vector}};
  assert.equal(canonicalAuthorizedV6(item), true);
  assert.equal(canonicalAuthorizedV6({...item, status: "EVIDENCE_READY"}), false);
  assert.equal(canonicalAuthorizedV6({...item, authorization: {...item.authorization, failed_checks: ["purpose_aligned"]}}), false);
  assert.equal(canonicalAuthorizedV6({...item, authorization: {...item.authorization, vector: {...vector, activity_permitted: false}}}), false);
});

console.log("V6_AUTHORIZATION_REGRESSION: 6 passed");
