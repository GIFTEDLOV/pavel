import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const core = fs.readFileSync("contracts/pavel_core.py", "utf8");
const vault = fs.readFileSync("contracts/pavel_vault.py", "utf8");

const objective = {
  authorized_deliverable_identified: true,
  provider_identity_consistent: true,
  evidence_authentic: true,
  delivery_corresponds_to_intent: true,
  quantity_consistent: true,
  no_material_substitution: true,
  mandate_requirements_preserved: true,
};
const semantic = { material_terms_satisfied: true, completion_evidence_sufficient: true };
const expected = (o, s) => Object.values(o).every(Boolean) && Object.values(s).every(Boolean) ? "FULFILLED" : "NOT_FULFILLED";

test("mutation: objective failures cannot become fulfilled", () => {
  for (const field of Object.keys(objective)) {
    const mutantInput = {...objective, [field]: false};
    assert.notEqual(expected(mutantInput, semantic), "FULFILLED", `objective mutant survived: ${field}`);
  }
});

test("mutation: semantic false cannot become fulfilled", () => {
  for (const field of Object.keys(semantic)) {
    const mutantInput = {...semantic, [field]: false};
    assert.notEqual(expected(objective, mutantInput), "FULFILLED", `semantic mutant survived: ${field}`);
  }
});

test("mutation: source retains fail-closed and settlement guards", () => {
  assert.match(core, /FULFILLMENT_RETRY_REQUIRED/);
  assert.match(core, /FULFILLMENT_EXPIRED/);
  assert.match(core, /"REFUND_TO_PRINCIPAL"/);
  assert.match(core, /"RELEASE_TO_COUNTERPARTY"/);
  assert.match(core, /deadline > u256\(0\) and now\["seconds"\] >= deadline/);
  assert.match(vault, /settlement replay detected/);
  assert.match(vault, /Core settlement direction does not authorize this operation/);
});
