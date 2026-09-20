import hashlib
import json

import pytest

from .conftest import BASE_TIME, configure_and_seal_core, create_submitted_intent, seed_fulfilled_intent


def _hash(body: str) -> str:
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _open_seeded(core, direct_vm, owner, agent, *, challenger, reason):
    mandate_id = configure_and_seal_core(core, direct_vm, owner, agent)
    intent_id = create_submitted_intent(core, direct_vm, owner, agent, mandate_id)
    seed_fulfilled_intent(core, intent_id)
    direct_vm.sender = challenger
    challenge_id = core.open_dispute(intent_id, reason)
    return intent_id, challenge_id


def _define_challenge(core, direct_vm, challenge_id, challenger, body, suffix="a"):
    direct_vm.sender = challenger
    evidence_id = core.define_challenge_evidence(
        challenge_id,
        "CHALLENGE",
        "https://challenge.example/" + suffix,
        "challenge.example",
        _hash(body),
        len(body.encode("utf-8")),
        "",
        0,
    )
    return evidence_id


@pytest.mark.direct
def test_submitted_and_infrastructure_retry_challenges_do_not_block_settlement(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    intent_id, challenge_id = _open_seeded(core, direct_vm, direct_owner, direct_alice, challenger=direct_bob, reason="temporary notice")
    assert json.loads(core.get_dispute(challenge_id))["status"] == "SUBMITTED"
    assert json.loads(core.get_settlement_instruction(intent_id))["status"] == "FULFILLED"
    body = "temporary challenge evidence"
    _define_challenge(core, direct_vm, challenge_id, direct_bob, body)
    direct_vm.mock_web(r"challenge\.example/a", {"status": 503, "body": "unavailable"})
    core.stage_challenge_evidence(challenge_id)
    assert json.loads(core.get_dispute(challenge_id))["status"] == "EVIDENCE_RETRY_REQUIRED"
    assert json.loads(core.get_settlement_instruction(intent_id))["status"] == "FULFILLED"


@pytest.mark.direct
def test_inadmissible_challenge_does_not_block_settlement(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    intent_id, challenge_id = _open_seeded(core, direct_vm, direct_owner, direct_alice, challenger=direct_bob, reason="bad notice")
    body = "committed body"
    _define_challenge(core, direct_vm, challenge_id, direct_bob, body)
    direct_vm.mock_web(r"challenge\.example/a", {"status": 200, "body": "different bytes"})
    core.stage_challenge_evidence(challenge_id)
    dispute = json.loads(core.get_dispute(challenge_id))
    assert dispute["status"] == "INADMISSIBLE"
    assert dispute["last_error"] == "MALFORMED_EVIDENCE"
    assert json.loads(core.get_settlement_instruction(intent_id))["status"] == "FULFILLED"


@pytest.mark.direct
def test_one_unresolved_qualifying_challenge_per_challenger(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    intent_id, first = _open_seeded(core, direct_vm, direct_owner, direct_alice, challenger=direct_bob, reason="first adverse notice")
    body = "first challenge"
    _define_challenge(core, direct_vm, first, direct_bob, body)
    direct_vm.mock_web(r"challenge\.example/a", {"status": 200, "body": body})
    core.stage_challenge_evidence(first)
    assert json.loads(core.get_dispute(first))["status"] == "QUALIFYING"
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("challenger already has an unresolved challenge"):
        core.open_dispute(intent_id, "second adverse notice")


@pytest.mark.direct
def test_one_unresolved_submitted_challenge_per_challenger_limits_capacity_capture(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    intent_id, _first = _open_seeded(core, direct_vm, direct_owner, direct_alice, challenger=direct_bob, reason="unqualified first notice")
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("challenger already has an unresolved challenge"):
        core.open_dispute(intent_id, "unqualified second notice")


@pytest.mark.direct
def test_duplicate_authenticated_evidence_set_is_inadmissible(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    intent_id, first = _open_seeded(core, direct_vm, direct_owner, direct_alice, challenger=direct_bob, reason="first evidence notice")
    body = "same evidence set"
    _define_challenge(core, direct_vm, first, direct_bob, body, "same")
    direct_vm.mock_web(r"challenge\.example/same", {"status": 200, "body": body})
    core.stage_challenge_evidence(first)
    direct_vm.sender = direct_owner
    second = core.open_dispute(intent_id, "different notice, same evidence")
    _define_challenge(core, direct_vm, second, direct_owner, body, "same-two")
    direct_vm.mock_web(r"challenge\.example/same-two", {"status": 200, "body": body})
    core.stage_challenge_evidence(second)
    record = json.loads(core.get_dispute(second))
    assert record["status"] == "INADMISSIBLE"
    assert record["last_error"] == "EVIDENCE_SET_REPLAY"
    assert json.loads(core.get_settlement_instruction(intent_id))["status"] == "CHALLENGE_BLOCKED"


@pytest.mark.direct
def test_qualifying_challenge_expires_after_bounded_grace(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    intent_id, challenge_id = _open_seeded(core, direct_vm, direct_owner, direct_alice, challenger=direct_bob, reason="stale notice")
    body = "stale challenge"
    _define_challenge(core, direct_vm, challenge_id, direct_bob, body)
    direct_vm.mock_web(r"challenge\.example/a", {"status": 200, "body": body})
    core.stage_challenge_evidence(challenge_id)
    assert json.loads(core.get_settlement_instruction(intent_id))["status"] == "CHALLENGE_BLOCKED"
    direct_vm.warp("2030-01-01T03:00:01Z")
    core.expire_challenge(challenge_id)
    assert json.loads(core.get_dispute(challenge_id))["status"] == "EXPIRED"
    settled = json.loads(core.get_settlement_instruction(intent_id))
    assert settled["status"] == "FULFILLED"
    assert settled["direction"] == "RELEASE_TO_COUNTERPARTY"


@pytest.mark.direct
def test_challenge_indexes_are_append_only_and_bounded(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    intent_id, first = _open_seeded(core, direct_vm, direct_owner, direct_alice, challenger=direct_bob, reason="index one")
    direct_vm.sender = direct_owner
    second = core.open_dispute(intent_id, "index two")
    assert core.get_challenge_count(intent_id) == 2
    assert core.get_challenge_id(intent_id, 0) == first
    assert core.get_challenge_id(intent_id, 1) == second
    with direct_vm.expect_revert("challenge index out of bounds"):
        core.get_challenge_id(intent_id, 2)


@pytest.mark.direct
def test_identical_challenge_submission_cannot_be_reopened(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    intent_id, _first = _open_seeded(core, direct_vm, direct_owner, direct_alice, challenger=direct_bob, reason="identical notice")
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("identical challenge already submitted"):
        core.open_dispute(intent_id, "identical notice")
