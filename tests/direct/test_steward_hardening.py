import hashlib
import json

import pytest

from .conftest import (
    BASE_TIME,
    add_evidence,
    address_text,
    configure_and_seal_core,
    create_submitted_intent,
    seed_fulfilled_intent,
)


def _body_hash(body: str) -> str:
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


@pytest.mark.direct
def test_evidence_recovery_preserves_committed_identity(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    body = "Provider: Atlas GPU\nAmount: 3 GEN"
    evidence_id = add_evidence(core, direct_vm, direct_alice, intent_id, body=body)
    original = json.loads(core.get_evidence(intent_id, 0))

    direct_vm.mock_web(r"evidence\.example/quote", {"status": 503, "body": "temporarily unavailable"})
    direct_vm.strict_mocks = True
    core.stage_evidence(intent_id)
    assert json.loads(core.get_intent(intent_id))["status"] == "EVIDENCE_RETRY_REQUIRED"

    direct_vm.sender = direct_alice
    core.configure_evidence_recovery(intent_id, evidence_id, "https://mirror.example/quote-copy")
    assert json.loads(core.get_intent(intent_id))["status"] == "EVIDENCE_RECOVERY_REQUIRED"
    direct_vm.mock_web(r"mirror\.example/quote-copy", {"status": 200, "body": body})
    core.stage_evidence(intent_id)

    recovered = json.loads(core.get_evidence(intent_id, 0))
    current = json.loads(core.get_intent(intent_id))
    snapshot = json.loads(core.get_snapshot(current["current_snapshot_id"]))
    capture = snapshot["captures"][0]
    assert current["status"] == "EVIDENCE_READY"
    assert recovered["evidence_id"] == original["evidence_id"] == evidence_id
    assert recovered["mandate_id"] == original["mandate_id"]
    assert recovered["intent_id"] == original["intent_id"]
    assert recovered["evidence_kind"] == original["evidence_kind"]
    assert recovered["committed_sha256"] == _body_hash(body)
    assert recovered["committed_byte_length"] == str(len(body.encode("utf-8")))
    assert recovered["expected_authority"] == original["expected_authority"]
    assert recovered["policy_fingerprint"] == original["policy_fingerprint"]
    assert capture["url"] == original["origin_url"]
    assert capture["transport_url"] == "https://mirror.example/quote-copy"
    assert snapshot["evidence_set_identity"] == current["evidence_set_identity"]

    with direct_vm.expect_revert("captured evidence identity cannot be recovered"):
        core.configure_evidence_recovery(intent_id, evidence_id, "https://mirror.example/second-copy")


@pytest.mark.direct
def test_evidence_recovery_rejects_mismatch_authority_length_hash_and_identity(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    body = "Provider: Atlas GPU\nAmount: 3 GEN"
    evidence_id = add_evidence(core, direct_vm, direct_alice, intent_id, body=body)
    direct_vm.mock_web(r"evidence\.example/quote", {"status": 503, "body": "temporary"})
    core.stage_evidence(intent_id)

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("recovery transport authority is not approved"):
        core.configure_evidence_recovery(intent_id, evidence_id, "https://lookalike.example/quote")
    with direct_vm.expect_revert("record does not exist"):
        core.configure_evidence_recovery(intent_id, "E-999", "https://mirror.example/quote-copy")

    core.configure_evidence_recovery(intent_id, evidence_id, "https://mirror.example/quote-copy")
    direct_vm.mock_web(r"mirror\.example/quote-copy", {"status": 200, "body": "different bytes"})
    core.stage_evidence(intent_id)
    assert json.loads(core.get_intent(intent_id))["status"] == "EVIDENCE_RECOVERY_REQUIRED"
    immutable = json.loads(core.get_evidence(intent_id, 0))
    assert immutable["committed_sha256"] == _body_hash(body)
    assert immutable["committed_byte_length"] == str(len(body.encode("utf-8")))
    with direct_vm.expect_revert("recovery transport has already been consumed"):
        core.configure_evidence_recovery(intent_id, evidence_id, "https://mirror.example/second-copy")


@pytest.mark.direct
def test_evidence_recovery_rejects_committed_length_mismatch_even_when_hash_matches(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    body = "Provider: Atlas GPU\nAmount: 3 GEN"
    direct_vm.sender = direct_alice
    evidence_id = core.define_evidence(intent_id, "QUOTE", "https://evidence.example/quote", "evidence.example", _body_hash(body), len(body.encode("utf-8")) + 1, "mirror.example", 0)
    direct_vm.mock_web(r"evidence\.example/quote", {"status": 503, "body": "temporary"})
    core.stage_evidence(intent_id)
    direct_vm.sender = direct_alice
    core.configure_evidence_recovery(intent_id, evidence_id, "https://mirror.example/quote-copy")
    direct_vm.mock_web(r"mirror\.example/quote-copy", {"status": 200, "body": body})
    core.stage_evidence(intent_id)
    assert json.loads(core.get_intent(intent_id))["status"] == "EVIDENCE_RECOVERY_REQUIRED"


@pytest.mark.direct
def test_source_authority_is_sealed_and_not_caller_selected(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("source authority is not sealed in mandate policy"):
        core.define_evidence(intent_id, "AUTHORITY", "https://unrelated.example/source", "unrelated.example", "", 0, "", 0)
    with direct_vm.expect_revert("expected authority does not match URL host"):
        core.define_evidence(intent_id, "AUTHORITY", "https://evidence.example/source", "lookalike.example", "", 0, "", 0)


@pytest.mark.direct
def test_permissionless_challenges_are_indexed_and_independently_block_settlement(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    seed_fulfilled_intent(core, intent_id)

    direct_vm.sender = direct_owner
    first = core.open_dispute(intent_id, "DISPUTE-A principal adverse notice")
    direct_vm.sender = direct_alice
    second = core.open_dispute(intent_id, "DISPUTE-B counterparty adverse notice")
    direct_vm.sender = direct_bob
    third = core.open_dispute(intent_id, "DISPUTE-C independent adverse notice")
    assert [core.get_challenge_id(intent_id, i) for i in range(3)] == [first, second, third]
    assert json.loads(core.get_intent(intent_id))["status"] == "FULFILLED"
    submitted = json.loads(core.get_settlement_instruction(intent_id))
    assert submitted["status"] == "FULFILLED"
    assert submitted["direction"] == "RELEASE_TO_COUNTERPARTY"
    assert submitted["oldest_open_challenge"] == ""

    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("only the challenger may define challenge evidence"):
        core.define_challenge_evidence(third, "CHALLENGE", "https://challenge.example/c", "challenge.example", "", 0, "", 0)

    challenges = [(first, direct_owner, "A", "RELEASE_TO_COUNTERPARTY"), (second, direct_alice, "B", "REFUND_TO_PRINCIPAL"), (third, direct_bob, "C", "RELEASE_TO_COUNTERPARTY")]
    for challenge_id, challenger, suffix, _outcome in challenges:
        body = "challenge evidence " + suffix
        direct_vm.sender = challenger
        core.define_challenge_evidence(challenge_id, "CHALLENGE", "https://challenge.example/" + suffix, "challenge.example", _body_hash(body), len(body.encode("utf-8")), "", 0)
        direct_vm.mock_web("challenge\\.example/" + suffix, {"status": 200, "body": body})
        core.stage_challenge_evidence(challenge_id)
        assert json.loads(core.get_dispute(challenge_id))["status"] == "QUALIFYING"
        if challenge_id == first:
            blocked = json.loads(core.get_settlement_instruction(intent_id))
            assert blocked["status"] == "CHALLENGE_BLOCKED"
            assert blocked["direction"] == ""
            assert blocked["oldest_open_challenge"] == first

    vectors = {
        "DISPUTE-A": "RELEASE_TO_COUNTERPARTY",
        "DISPUTE-B": "REFUND_TO_PRINCIPAL",
        "DISPUTE-C": "RELEASE_TO_COUNTERPARTY",
    }
    fields = {"original_outcome_supported": True, "challenge_supported": True, "response_sufficient": True, "evidence_sufficient": True}
    for challenge_id, _challenger, suffix, outcome in challenges:
        result = {"schema": "pavel-dispute-v1", "outcome": outcome, "explanation": "bounded", **fields}
        direct_vm.mock_llm("DISPUTE-" + suffix, json.dumps(result))
        direct_vm.sender = direct_bob
        core.adjudicate_dispute(challenge_id)
        record = json.loads(core.get_dispute(challenge_id))
        assert record["challenge_id"] == challenge_id
        assert record["evidence_ids"].startswith("E-")
        assert record["independent_snapshot_id"] != ""
        assert record["resolved_at"] != ""
        remaining = json.loads(core.get_settlement_instruction(intent_id))
        if challenge_id != third:
            assert remaining["status"] == "CHALLENGE_BLOCKED"

    assert json.loads(core.get_dispute(first))["status"] == "RESOLVED"
    assert json.loads(core.get_dispute(second))["status"] == "RESOLVED"
    assert json.loads(core.get_dispute(third))["status"] == "RESOLVED"
    final = json.loads(core.get_settlement_instruction(intent_id))
    assert final["status"] == "ADJUDICATED_RELEASE"
    assert final["direction"] == "RELEASE_TO_COUNTERPARTY"


@pytest.mark.direct
def test_challenge_deadline_and_append_only_history(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    seed_fulfilled_intent(core, intent_id)
    direct_vm.sender = direct_bob
    first = core.open_dispute(intent_id, "DISPUTE-OLD")
    item = json.loads(core.get_intent(intent_id))
    item["challenge_deadline"] = "1"
    core.intents[intent_id] = json.dumps(item, sort_keys=True, separators=(",", ":"))
    with direct_vm.expect_revert("challenge window has closed"):
        core.open_dispute(intent_id, "DISPUTE-LATE")
    assert json.loads(core.get_dispute(first))["status"] == "SUBMITTED"
