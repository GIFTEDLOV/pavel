import json
import subprocess

import pytest

from tests.direct.conftest import add_evidence, configure_and_seal_core, create_submitted_intent


@pytest.mark.adversarial
def test_static_semantic_authority_gate_passes():
    result = subprocess.run(["node", "scripts/semantic-authority-audit.mjs"], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.adversarial
def test_authorization_extra_economic_fields_are_rejected_without_mutating_frozen_terms(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.warp("2030-01-01T00:00:00Z")
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    add_evidence(core, direct_vm, direct_alice, intent_id)
    direct_vm.mock_web(r"evidence\.example/quote", {"status": 200, "body": "Provider: Atlas GPU\nAmount: 3 GEN"})
    core.stage_evidence(intent_id)
    intent_before = json.loads(core.get_intent(intent_id))
    result = {"schema": "pavel-authorization-v2", "recipient": "0x1111111111111111111111111111111111111111", "amount": "999", "principal": "0x1111111111111111111111111111111111111111"}
    for field in ("purpose_aligned", "activity_permitted", "prohibited_activity_absent", "counterparty_scope_satisfied", "deliverable_in_scope", "commercial_terms_consistent", "evidence_semantically_sufficient", "duplicate_semantic_purchase_absent", "authority_scope_preserved", "fulfillment_terms_defined", "external_dependencies_disclosed", "constitution_satisfied"):
        result[field] = True
    direct_vm.mock_llm(r"pavel-authorization-v2", json.dumps(result))
    core.authorize_intent(intent_id)
    after = json.loads(core.get_intent(intent_id))
    assert after["status"] == "AUTHORIZATION_RETRY_REQUIRED"
    assert after["recipient"] == intent_before["recipient"]
    assert after["amount"] == intent_before["amount"]


@pytest.mark.adversarial
def test_fulfillment_and_delegation_schema_reject_economic_identity_fields(direct_vm, direct_deploy):
    direct_vm.warp("2030-01-01T00:00:00Z")
    core = direct_deploy("contracts/pavel_core.py")
    fulfillment = {"schema": "pavel-fulfillment-v2", "recipient": "0x1111111111111111111111111111111111111111"}
    for field in ("material_terms_satisfied", "completion_evidence_sufficient"):
        fulfillment[field] = True
    assert core._fulfillment_valid(fulfillment) is False
    delegation = {"schema": "pavel-delegation-v1", "explanation": "bounded", "authorized_agent": "0x1111111111111111111111111111111111111111"}
    for field in ("purpose_is_subset", "permitted_activity_is_subset", "forbidden_activity_not_weakened", "counterparty_scope_not_expanded", "evidence_requirements_not_weakened", "fulfillment_requirements_not_weakened", "parent_constitution_preserved"):
        delegation[field] = True
    assert core._valid_vector(delegation, ("purpose_is_subset", "permitted_activity_is_subset", "forbidden_activity_not_weakened", "counterparty_scope_not_expanded", "evidence_requirements_not_weakened", "fulfillment_requirements_not_weakened", "parent_constitution_preserved")) is False
