import hashlib
import json

import pytest

from .conftest import BASE_TIME, add_evidence, configure_and_seal_core, create_submitted_intent


def _digest(body: str) -> str:
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _setup(direct_vm, direct_deploy, owner, agent):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, owner, agent)
    intent_id = create_submitted_intent(core, direct_vm, owner, agent, mandate_id)
    body = "immutable provider quote"
    evidence_id = add_evidence(core, direct_vm, agent, intent_id, body=body)
    return core, mandate_id, intent_id, evidence_id, body


@pytest.mark.parametrize("field", ["evidence_kind", "intent_id", "mandate_id", "policy_fingerprint"])
@pytest.mark.direct
def test_recovery_rejects_committed_identity_mutation(direct_vm, direct_deploy, direct_owner, direct_alice, field):
    core, mandate_id, intent_id, evidence_id, body = _setup(direct_vm, direct_deploy, direct_owner, direct_alice)
    definition = json.loads(core.get_evidence(intent_id, 0))
    definition[field] = {"evidence_kind": "INVOICE", "intent_id": "I-999", "mandate_id": "M-999", "policy_fingerprint": "f" * 64}[field]
    core.evidence_defs[evidence_id] = json.dumps(definition, sort_keys=True, separators=(",", ":"))
    direct_vm.sender = direct_alice
    expected_error = "evidence does not belong to intent" if field == "intent_id" else "committed evidence identity is inconsistent"
    with direct_vm.expect_revert(expected_error):
        core.configure_evidence_recovery(intent_id, evidence_id, "https://mirror.example/quote-copy")


@pytest.mark.direct
def test_recovery_cannot_reuse_mirror_content_for_another_intent(direct_vm, direct_deploy, direct_owner, direct_alice):
    core, mandate_id, intent_one, evidence_one, body_one = _setup(direct_vm, direct_deploy, direct_owner, direct_alice)
    direct_vm.sender = direct_alice
    intent_two = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id, amount=4 * 10**18)
    body_two = "different provider quote"
    evidence_two = add_evidence(core, direct_vm, direct_alice, intent_two, body=body_two, url="https://evidence.example/quote-two")

    direct_vm.mock_web(r"evidence\.example/quote", {"status": 503, "body": "offline"})
    core.stage_evidence(intent_one)
    core.configure_evidence_recovery(intent_one, evidence_one, "https://mirror.example/shared")
    direct_vm.mock_web(r"mirror\.example/shared", {"status": 200, "body": body_one})
    core.stage_evidence(intent_one)
    assert json.loads(core.get_intent(intent_one))["status"] == "EVIDENCE_READY"

    direct_vm.mock_web(r"evidence\.example/quote-two", {"status": 503, "body": "offline"})
    core.stage_evidence(intent_two)
    core.configure_evidence_recovery(intent_two, evidence_two, "https://mirror.example/shared")
    direct_vm.mock_web(r"mirror\.example/shared", {"status": 200, "body": body_one})
    core.stage_evidence(intent_two)
    second = json.loads(core.get_intent(intent_two))
    assert second["status"] in ("EVIDENCE_REPAIR_REQUIRED", "EVIDENCE_RECOVERY_REQUIRED")
    assert json.loads(core.get_evidence(intent_two, 0))["committed_sha256"] == _digest(body_two)


@pytest.mark.direct
def test_original_source_change_after_snapshot_cannot_mutate_frozen_snapshot(direct_vm, direct_deploy, direct_owner, direct_alice):
    core, _mandate_id, intent_id, evidence_id, body = _setup(direct_vm, direct_deploy, direct_owner, direct_alice)
    direct_vm.mock_web(r"evidence\.example/quote", {"status": 200, "body": body})
    core.stage_evidence(intent_id)
    first = json.loads(core.get_intent(intent_id))
    snapshot_before = json.loads(core.get_snapshot(first["current_snapshot_id"]))
    direct_vm.mock_web(r"evidence\.example/quote", {"status": 200, "body": "mutated original"})
    with direct_vm.expect_revert("no uncaptured evidence definitions remain"):
        core.stage_evidence(intent_id)
    snapshot_after = json.loads(core.get_snapshot(first["current_snapshot_id"]))
    assert snapshot_after == snapshot_before
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("captured evidence identity cannot be recovered"):
        core.configure_evidence_recovery(intent_id, evidence_id, "https://mirror.example/quote-copy")


@pytest.mark.direct
def test_recovery_transport_is_one_shot_and_original_recovery_cannot_rewrite_identity(direct_vm, direct_deploy, direct_owner, direct_alice):
    core, _mandate_id, intent_id, evidence_id, body = _setup(direct_vm, direct_deploy, direct_owner, direct_alice)
    direct_vm.mock_web(r"evidence\.example/quote", {"status": 503, "body": "offline"})
    core.stage_evidence(intent_id)
    direct_vm.sender = direct_alice
    core.configure_evidence_recovery(intent_id, evidence_id, "https://mirror.example/first")
    with direct_vm.expect_revert("recovery transport is already configured"):
        core.configure_evidence_recovery(intent_id, evidence_id, "https://mirror.example/second")
    direct_vm.mock_web(r"mirror\.example/first", {"status": 200, "body": body})
    core.stage_evidence(intent_id)
    assert json.loads(core.get_intent(intent_id))["status"] == "EVIDENCE_READY"
    assert json.loads(core.get_evidence(intent_id, 0))["origin_url"] == "https://evidence.example/quote"


@pytest.mark.direct
def test_original_transport_can_recover_after_a_failed_mirror_without_identity_change(direct_vm, direct_deploy, direct_owner, direct_alice):
    core, _mandate_id, intent_id, evidence_id, body = _setup(direct_vm, direct_deploy, direct_owner, direct_alice)
    direct_vm.mock_web(r"evidence\.example/quote", {"status": 503, "body": "offline"})
    core.stage_evidence(intent_id)
    direct_vm.sender = direct_alice
    core.configure_evidence_recovery(intent_id, evidence_id, "https://mirror.example/failed-copy")
    direct_vm.mock_web(r"mirror\.example/failed-copy", {"status": 200, "body": "wrong bytes"})
    core.stage_evidence(intent_id)
    assert json.loads(core.get_intent(intent_id))["status"] == "EVIDENCE_RECOVERY_REQUIRED"
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"evidence\.example/quote", {"status": 200, "body": body})
    core.stage_evidence(intent_id)
    intent = json.loads(core.get_intent(intent_id))
    snapshot = json.loads(core.get_snapshot(intent["current_snapshot_id"]))
    assert intent["status"] == "EVIDENCE_READY"
    assert snapshot["captures"][0]["transport_url"] == "https://evidence.example/quote"
    assert json.loads(core.get_evidence(intent_id, 0))["evidence_id"] == evidence_id


@pytest.mark.direct
def test_uncommitted_evidence_identity_is_finalized_after_capture(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    direct_vm.sender = direct_alice
    evidence_id = core.define_evidence(intent_id, "PRODUCT_SERVICE", "https://evidence.example/product", "evidence.example", "", 0, "evidence.example", 0)
    definition = json.loads(core.get_evidence(intent_id, 0))
    assert definition["evidence_id"] == evidence_id
    assert definition["committed_sha256"] == ""
    assert definition["committed_byte_length"] == "0"
    direct_vm.mock_web(r"evidence\.example/product", {"status": 200, "body": "Product evidence"})
    direct_vm.strict_mocks = True
    core.stage_evidence(intent_id)
    intent = json.loads(core.get_intent(intent_id))
    definition = json.loads(core.get_evidence(intent_id, 0))
    assert intent["status"] == "EVIDENCE_READY"
    assert definition["committed_sha256"] == hashlib.sha256(b"Product evidence").hexdigest()
    assert definition["committed_byte_length"] == str(len(b"Product evidence"))
    assert definition["identity_fingerprint"] == core._evidence_identity_fingerprint(definition)
    assert intent["current_snapshot_id"] == "S-1"


@pytest.mark.direct
def test_legacy_empty_commitment_mutation_reproduces_stale_identity_failure(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    direct_vm.sender = direct_alice
    core.define_evidence(intent_id, "PRODUCT_SERVICE", "https://evidence.example/product", "evidence.example", "", 0, "evidence.example", 0)
    definition = json.loads(core.get_evidence(intent_id, 0))
    legacy_mutation = dict(definition)
    legacy_mutation["committed_sha256"] = hashlib.sha256(b"Product evidence").hexdigest()
    legacy_mutation["committed_byte_length"] = str(len(b"Product evidence"))
    legacy_mutation["expected_hash"] = legacy_mutation["committed_sha256"]
    assert legacy_mutation["identity_fingerprint"] != core._evidence_identity_fingerprint(legacy_mutation)
