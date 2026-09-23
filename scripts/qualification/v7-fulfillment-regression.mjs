import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const core = fs.readFileSync("contracts/pavel_core.py", "utf8");
const vault = fs.readFileSync("contracts/pavel_vault.py", "utf8");

test("V7 fulfillment has exactly two consensus booleans", () => {
  assert.match(core, /FULFILLMENT_SEMANTIC_SCHEMA = "pavel-fulfillment-v2"/);
  assert.match(core, /FULFILLMENT_SEMANTIC_FIELDS = \(\s*"material_terms_satisfied",\s*"completion_evidence_sufficient",\s*\)/s);
  assert.match(core, /len\(result\) != len\(FULFILLMENT_SEMANTIC_FIELDS\) \+ 1/);
  assert.doesNotMatch(core, /pavel-fulfillment-v1/);
});

test("V7 fulfillment objective checks are deterministic and separate", () => {
  for (const field of [
    "authorized_deliverable_identified",
    "provider_identity_consistent",
    "evidence_authentic",
    "delivery_corresponds_to_intent",
    "quantity_consistent",
    "no_material_substitution",
    "mandate_requirements_preserved",
  ]) assert.match(core, new RegExp(`"${field}"`));
  assert.match(core, /objective_checks = self\._fulfillment_objective_checks/);
  assert.match(core, /OBJECTIVE_CHECKS=<OBJECTIVE_BEGIN>/);
  assert.match(core, /must not be re-evaluated/);
});

test("V7 rejects arbitrary fulfillment truncation", () => {
  assert.match(core, /MAX_FULFILLMENT_EVIDENCE_BYTES = 4096/);
  assert.match(core, /definition\.get\("evidence_kind"\) == "FULFILLMENT" and len\(raw\) > MAX_FULFILLMENT_EVIDENCE_BYTES/);
  assert.match(core, /result\["content"\] = text if definition\.get\("evidence_kind"\) == "FULFILLMENT"/);
  assert.match(core, /len\(content_bytes\) > MAX_FULFILLMENT_EVIDENCE_BYTES/);
  const contextBlock = core.match(/def _fulfillment_evidence_context[\s\S]*?(?=\n    def _fulfillment_objective_checks)/)?.[0] ?? "";
  assert.notEqual(contextBlock, "");
  assert.doesNotMatch(contextBlock, /capture\["content"\]\[:MAX_EXCERPT\]/);
});

test("V7 computes settlement direction from canonical checks", () => {
  assert.match(core, /item\["settlement_direction"\] = "RELEASE_TO_COUNTERPARTY" if fulfilled else "REFUND_TO_PRINCIPAL"/);
  assert.match(core, /item\["settlement_direction"\] = "REFUND_TO_PRINCIPAL"/);
  assert.match(core, /def expire_fulfillment\(self, intent_id: str\)/);
  assert.match(core, /item\["status"\] = "FULFILLMENT_EXPIRED"/);
  assert.match(core, /"fulfillment_timeout"/);
  assert.match(core, /deadline > u256\(0\) and now\["seconds"\] >= deadline/);
});

test("Vault accepts only the two Core-issued settlement directions", () => {
  assert.match(vault, /direction in \("RELEASE_TO_COUNTERPARTY", "REFUND_TO_PRINCIPAL"\)/);
  assert.match(vault, /Core settlement direction does not authorize this operation/);
  assert.match(vault, /settlement replay detected/);
});

test("authorization V2 remains unchanged", () => {
  assert.match(core, /AUTHORIZATION_V2_SCHEMA = "pavel-authorization-v2"/);
  assert.match(core, /AUTHORIZATION_VALIDATOR_KEYS = AUTHORIZATION_V2_KEYS/);
});
