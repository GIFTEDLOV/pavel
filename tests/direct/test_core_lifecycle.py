import json

import pytest

from .conftest import BASE_TIME, add_evidence, address_text, configure_and_seal_core, create_submitted_intent


@pytest.mark.direct
def test_mandate_seals_and_becomes_immutable(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    mandate = json.loads(core.get_mandate(mandate_id))
    assert mandate["status"] == "SEALED"
    assert len(mandate["definition_hash"]) == 64
    with direct_vm.expect_revert("mandate is no longer configurable"):
        direct_vm.sender = direct_owner
        core.configure_mandate(mandate_id, "mutated", "x", "x", "x", "x", 1, 1, 1, 1, 1893456000, 1924992000, 1, "x", "evidence.example", "x", "x", False)


@pytest.mark.direct
def test_intent_freezes_transaction_data_and_rejects_unauthorized_agent(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("caller is not the authorized agent"):
        core.create_intent(mandate_id, address_text(direct_owner), address_text(direct_owner), 1, "x", "x", "x", "x", "x", 1924990000)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    intent = json.loads(core.get_intent(intent_id))
    assert intent["status"] == "SUBMITTED"
    assert intent["intent_fingerprint"]
    with direct_vm.expect_revert("intent is not draft"):
        core.submit_intent(intent_id)


@pytest.mark.direct
def test_web_capture_distinguishes_authenticated_evidence_from_client_failure(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    add_evidence(core, direct_vm, direct_alice, intent_id)
    direct_vm.mock_web(r"evidence\.example/quote", {"status": 200, "body": "Provider: Atlas GPU\nAmount: 3 GEN"})
    direct_vm.strict_mocks = True
    core.stage_evidence(intent_id)
    intent = json.loads(core.get_intent(intent_id))
    assert intent["status"] == "EVIDENCE_READY"
    snapshot = json.loads(core.get_snapshot(intent["current_snapshot_id"]))
    assert snapshot["captures"][0]["capture_class"] == "AUTHENTICATED"
    assert snapshot["captures"][0]["byte_length"] > 0


@pytest.mark.direct
def test_404_is_repairable_evidence_not_authorization_guilt(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    add_evidence(core, direct_vm, direct_alice, intent_id)
    direct_vm.mock_web(r"evidence\.example/quote", {"status": 404, "body": "not found"})
    direct_vm.strict_mocks = True
    core.stage_evidence(intent_id)
    assert json.loads(core.get_intent(intent_id))["status"] == "EVIDENCE_REPAIR_REQUIRED"


@pytest.mark.direct
def test_malformed_authorization_vector_fails_closed_with_retry_state(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    add_evidence(core, direct_vm, direct_alice, intent_id)
    direct_vm.mock_web(r"evidence\.example/quote", {"status": 200, "body": "Provider: Atlas GPU\nAmount: 3 GEN"})
    core.stage_evidence(intent_id)
    malformed = {"schema": "pavel-authorization-v1", "explanation": "bad", "purpose_aligned": "true"}
    direct_vm.mock_llm(r"pavel-authorization-v1", json.dumps(malformed))
    direct_vm.strict_mocks = True
    core.authorize_intent(intent_id)
    assert json.loads(core.get_intent(intent_id))["status"] == "AUTHORIZATION_RETRY_REQUIRED"


@pytest.mark.direct
def test_transaction_datetime_uses_message_context_and_rejects_malformed_zone(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.warp("2030-01-01T00:00:00+bad")
    core = direct_deploy("contracts/pavel_core.py")
    direct_vm.sender = direct_owner
    core.register_principal()
    core.register_agent(address_text(direct_alice), "agent")
    with direct_vm.expect_revert("malformed transaction timezone"):
        core.create_mandate(address_text(direct_alice), "")
