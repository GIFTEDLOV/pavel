import importlib
import json

import pytest

from .conftest import BASE_TIME, VALID_FROM, add_evidence, address_text, configure_and_seal_core, create_submitted_intent


def _auth_result():
    return {"schema": "pavel-authorization-v1", "explanation": "bounded", "purpose_aligned": True, "activity_permitted": True, "prohibited_activity_absent": True, "counterparty_scope_satisfied": True, "deliverable_in_scope": True, "commercial_terms_consistent": True, "evidence_semantically_sufficient": True, "duplicate_semantic_purchase_absent": True, "authority_scope_preserved": True, "fulfillment_terms_defined": True, "external_dependencies_disclosed": True, "constitution_satisfied": True}


def _fulfillment_result():
    return {"schema": "pavel-fulfillment-v1", "outcome": "FULFILLED", "explanation": "bounded", "authorized_deliverable_identified": True, "provider_identity_consistent": True, "evidence_authentic": True, "delivery_corresponds_to_intent": True, "quantity_consistent": True, "material_terms_satisfied": True, "no_material_substitution": True, "completion_evidence_sufficient": True, "mandate_requirements_preserved": True}


@pytest.mark.direct
def test_register_principal_is_permissionless_for_the_calling_address_and_idempotent(direct_vm, direct_deploy, direct_owner, direct_bob):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    direct_vm.sender = direct_owner
    core.register_principal()
    core.register_principal()
    direct_vm.sender = direct_bob
    core.register_principal()


@pytest.mark.direct
def test_agent_and_counterparty_bindings_reject_wrong_owner_and_replay(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    direct_vm.sender = direct_owner
    core.register_principal()
    core.register_agent(address_text(direct_alice), "operations")
    core.register_agent(address_text(direct_alice), "operations")
    direct_vm.sender = direct_bob
    core.register_principal()
    with direct_vm.expect_revert("agent identity is already bound"):
        core.register_agent(address_text(direct_alice), "other")
    direct_vm.sender = direct_owner
    core.register_counterparty(address_text(direct_bob), "provider", "https://evidence.example")
    with direct_vm.expect_revert("counterparty wallet identity is already bound"):
        core.register_counterparty(address_text(direct_bob), "provider-again", "https://evidence.example")


@pytest.mark.direct
def test_vault_binding_is_owner_only_and_non_rebindable(direct_vm, direct_deploy, direct_owner, direct_bob):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only Core owner may bind the Vault"):
        core.set_vault_address(address_text(direct_bob))
    direct_vm.sender = direct_owner
    core.set_vault_address(address_text(direct_bob))
    with direct_vm.expect_revert("Vault binding is immutable"):
        core.set_vault_address(address_text(direct_owner))


@pytest.mark.direct
def test_delegation_review_is_controller_only_and_structured(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    parent = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    direct_vm.sender = direct_alice
    child = core.create_mandate(address_text(direct_bob), parent)
    core.configure_mandate(child, "Child", "Acquire Linux GPU infrastructure", "Do not externalize authority.", "Linux GPU infrastructure", "Trading and unrelated purchases", 4 * 10**18, 10 * 10**18, 30 * 24 * 60 * 60, 20 * 10**18, VALID_FROM, 1924992000, 3600, "Provider evidence required.", "evidence.example,mirror.example,challenge.example", "Exact deliverable must be evidenced.", "Refund only to principal.", False)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only the mandate controller may review delegation"):
        core.review_delegation(child)
    direct_vm.sender = direct_alice
    vector = {"schema": "pavel-delegation-v1", "explanation": "bounded", "purpose_is_subset": True, "permitted_activity_is_subset": True, "forbidden_activity_not_weakened": True, "counterparty_scope_not_expanded": True, "evidence_requirements_not_weakened": True, "fulfillment_requirements_not_weakened": True, "parent_constitution_preserved": True}
    direct_vm.mock_llm(r"pavel-delegation-v1", json.dumps(vector))
    core.review_delegation(child)
    assert json.loads(core.get_mandate(child))["delegation_status"] == "COMPATIBLE"


@pytest.mark.direct
def test_expire_intent_is_permissionless_only_after_deadline_and_replay_is_rejected(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    item = json.loads(core.get_intent(intent_id))
    item["expires_at"] = "1893456001"
    core.intents[intent_id] = json.dumps(item, sort_keys=True, separators=(",", ":"))
    direct_vm.warp("2030-01-01T00:00:02Z")
    core.expire_intent(intent_id)
    assert json.loads(core.get_intent(intent_id))["status"] == "EXPIRED"
    with direct_vm.expect_revert("intent cannot be expired from this state"):
        core.expire_intent(intent_id)


@pytest.mark.direct
def test_fulfillment_writes_require_reservation_and_use_structured_consensus(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")
    mandate_id = configure_and_seal_core(core, direct_vm, direct_owner, direct_alice)
    intent_id = create_submitted_intent(core, direct_vm, direct_owner, direct_alice, mandate_id)
    add_evidence(core, direct_vm, direct_alice, intent_id)
    direct_vm.mock_web(r"evidence\.example/quote", {"status": 200, "body": "Provider: Atlas GPU\nAmount: 3 GEN"})
    core.stage_evidence(intent_id)
    direct_vm.mock_llm(r"PAVEL authorization review", json.dumps(_auth_result()))
    core.authorize_intent(intent_id)
    intent = json.loads(core.get_intent(intent_id))

    class FakeVaultView:
        def get_reservation(self, requested_intent):
            return json.dumps({"intent_id": requested_intent, "mandate_id": intent["mandate_id"], "amount": intent["amount"], "recipient": intent["recipient"], "intent_fingerprint": intent["intent_fingerprint"], "status": "RESERVED"})

    class FakeVault:
        def view(self):
            return FakeVaultView()

    core._vault = lambda: FakeVault()
    direct_vm.sender = direct_alice
    core.start_fulfillment(intent_id)
    assert json.loads(core.get_intent(intent_id))["status"] == "FULFILLMENT_PENDING"
    direct_vm.mock_llm(r"PAVEL fulfillment review", json.dumps(_fulfillment_result()))
    core.assess_fulfillment(intent_id)
    assert json.loads(core.get_intent(intent_id))["status"] == "FULFILLED"
    with direct_vm.expect_revert("intent is not awaiting fulfillment assessment"):
        core.assess_fulfillment(intent_id)


@pytest.mark.direct
def test_vault_deposit_and_reservation_use_core_facts_and_replay_protection(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.warp(BASE_TIME)
    core_address = "0x" + "11" * 20
    vault = direct_deploy("contracts/pavel_vault.py", core_address)
    vault.bind_core()
    mandate_id = "M-1"
    intent_id = "I-1"
    fake_mandate = {"mandate_id": mandate_id, "principal": address_text(direct_owner), "status": "SEALED"}
    fake_auth = {"intent_id": intent_id, "intent_fingerprint": "a" * 64, "mandate_id": mandate_id, "mandate_fingerprint": "b" * 64, "status": "AUTHORIZED", "authorization_decision": "AUTHORIZED", "principal": address_text(direct_owner), "agent": address_text(direct_alice), "recipient": address_text(direct_owner), "counterparty": address_text(direct_owner), "counterparty_identity_id": "C-1", "counterparty_identity_fingerprint": "c" * 64, "counterparty_authority_origin": "evidence.example", "amount": str(3 * 10**18), "intent_expires_at": "1924992000", "mandate_status": "SEALED", "mandate_expires_at": "1924992000", "maximum_single_transaction": str(8 * 10**18), "epoch_budget": str(25 * 10**18), "epoch_duration_seconds": str(30 * 24 * 60 * 60), "total_budget": str(100 * 10**18), "allow_prior_reservations": False}

    class FakeCore:
        def view(self):
            return self
        def get_mandate(self, requested_mandate):
            return json.dumps(fake_mandate if requested_mandate == mandate_id else {})
        def get_authorization_for_vault(self, requested_intent):
            return json.dumps(fake_auth if requested_intent == intent_id else {})

    vault._core = lambda: FakeCore()
    direct_vm.sender = direct_owner
    direct_vm.value = 10 * 10**18
    vault.deposit(mandate_id)
    direct_vm.value = 0
    direct_vm.sender = direct_alice
    vault.reserve(intent_id)
    assert json.loads(vault.get_reservation(intent_id))["status"] == "RESERVED"
    with direct_vm.expect_revert("Intent has already been reserved"):
        vault.reserve(intent_id)


@pytest.mark.parametrize(
    ("direction", "method", "pending_key"),
    [("RELEASE_TO_COUNTERPARTY", "request_release", "release_pending"), ("REFUND_TO_PRINCIPAL", "request_refund", "refund_pending")],
)
@pytest.mark.direct
def test_vault_settlement_requests_are_one_shot_and_accounted_before_external_message(direct_vm, direct_deploy, direct_owner, direction, method, pending_key):
    direct_vm.warp(BASE_TIME)
    core_address = "0x" + "11" * 20
    vault = direct_deploy("contracts/pavel_vault.py", core_address)
    vault.bind_core()
    amount = 3 * 10**18
    intent_id = "I-settlement"
    mandate_id = "M-settlement"
    recipient = address_text(direct_owner)

    class FakeCore:
        def view(self):
            return self

        def get_settlement_instruction(self, requested_intent):
            assert requested_intent == intent_id
            return json.dumps({"direction": direction, "ready_at": "0"})

    vault._core = lambda: FakeCore()
    vault.deposited_by_mandate[mandate_id] = amount
    vault.available_by_mandate[mandate_id] = 0
    vault.reserved_by_mandate[mandate_id] = amount
    vault.release_pending_by_mandate[mandate_id] = 0
    vault.refund_pending_by_mandate[mandate_id] = 0
    vault.recovered_by_mandate[mandate_id] = 0
    vault.committed_by_mandate[mandate_id] = amount
    vault.epoch_start_by_mandate[mandate_id] = 0
    vault.epoch_spent_by_mandate[mandate_id] = 0
    vault.total_deposited = amount
    vault.total_reserved = amount
    vault.reservations[intent_id] = json.dumps({"intent_id": intent_id, "mandate_id": mandate_id, "principal": recipient, "recipient": recipient, "amount": str(amount), "status": "RESERVED", "settlement_id": ""}, sort_keys=True, separators=(",", ":"))
    vault.settlement_by_intent[intent_id] = ""
    getattr(vault, method)(intent_id)
    accounting = json.loads(vault.get_accounting(mandate_id))
    assert accounting[pending_key] == str(amount)
    assert json.loads(vault.get_reservation(intent_id))["status"] == pending_key.upper()
    with direct_vm.expect_revert("reservation is already pending or settled"):
        getattr(vault, method)(intent_id)
