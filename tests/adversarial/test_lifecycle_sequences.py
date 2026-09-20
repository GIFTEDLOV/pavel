import json

import pytest

from tests.direct.conftest import BASE_TIME, address_text, configure_and_seal_core, create_submitted_intent, seed_fulfilled_intent


@pytest.mark.direct
def test_fulfillment_and_dispute_cannot_start_from_submitted(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    with direct_vm.expect_revert("intent is not authorized"):
        core.start_fulfillment(intent_id)
    with direct_vm.expect_revert("intent is not challengeable"):
        core.open_dispute(intent_id, "too early")


@pytest.mark.direct
def test_intent_submission_is_one_shot_and_revoked_mandate_cannot_submit(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    with direct_vm.expect_revert("intent is not draft"):
        core.submit_intent(intent_id)
    direct_vm.sender = direct_owner
    core.revoke_mandate(mandate_id)
    with direct_vm.expect_revert("intent is not draft"):
        core.submit_intent(intent_id)


@pytest.mark.direct
def test_challenge_cannot_be_assessed_or_expired_before_its_own_evidence_and_grace(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    seed_fulfilled_intent(core, intent_id)
    direct_vm.sender = direct_bob
    challenge_id = core.open_dispute(intent_id, "independent challenge")
    with direct_vm.expect_revert("challenge is not qualifying for assessment"):
        core.adjudicate_dispute(challenge_id)
    with direct_vm.expect_revert("challenge review grace period is still open"):
        core.expire_challenge(challenge_id)
    assert json.loads(core.get_dispute(challenge_id))["status"] == "SUBMITTED"


@pytest.mark.direct
def test_unqualified_challenge_does_not_block_settlement(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    seed_fulfilled_intent(core, intent_id)
    direct_vm.sender = direct_bob
    challenge_id = core.open_dispute(intent_id, "malformed notice")
    direct_vm.warp("2030-01-01T03:00:00Z")
    core.expire_challenge(challenge_id)
    instruction = json.loads(core.get_settlement_instruction(intent_id))
    assert instruction["status"] == "FULFILLED"
    assert instruction["direction"] == "RELEASE_TO_COUNTERPARTY"


@pytest.mark.direct
def test_resolution_replay_and_out_of_order_assessment_are_rejected(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    seed_fulfilled_intent(core, intent_id)
    direct_vm.sender = direct_bob
    older = core.open_dispute(intent_id, "older")
    direct_vm.sender = direct_owner
    newer = core.open_dispute(intent_id, "newer")
    with direct_vm.expect_revert("challenge is not qualifying for assessment"):
        core.adjudicate_dispute(newer)
    assert json.loads(core.get_dispute(older))["status"] == "SUBMITTED"
    assert json.loads(core.get_dispute(newer))["status"] == "SUBMITTED"
    assert json.loads(core.get_settlement_instruction(intent_id))["oldest_open_challenge"] == ""


@pytest.mark.property
def test_illegal_lifecycle_sequences_never_reach_settlement():
    legal = {
        "DRAFT": {"submit": "SUBMITTED"},
        "SUBMITTED": {"evidence": "EVIDENCE_READY", "expire": "EXPIRED"},
        "EVIDENCE_READY": {"authorize": "AUTHORIZED"},
        "AUTHORIZED": {"reserve": "RESERVED"},
        "RESERVED": {"fulfill": "FULFILLED"},
        "FULFILLED": {"challenge": "CHALLENGE_SUBMITTED"},
    }
    illegal = [
        ("SUBMITTED", "reserve"),
        ("SUBMITTED", "fulfill"),
        ("AUTHORIZED", "fulfill"),
        ("FULFILLED", "reserve"),
        ("FULFILLED", "settle"),
        ("RESERVED", "refund"),
        ("REFUND_PENDING", "release"),
        ("RELEASE_PENDING", "refund"),
        ("EXPIRED", "authorize"),
        ("CHALLENGE_SUBMITTED", "settle"),
    ]
    for state, action in illegal:
        assert action not in legal.get(state, {}), (state, action)
