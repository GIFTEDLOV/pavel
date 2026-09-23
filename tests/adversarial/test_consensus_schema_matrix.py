import pytest


AUTH_FIELDS = [
    "purpose_aligned", "activity_permitted", "prohibited_activity_absent",
    "counterparty_scope_satisfied", "deliverable_in_scope", "commercial_terms_consistent",
    "evidence_semantically_sufficient", "duplicate_semantic_purchase_absent",
    "authority_scope_preserved", "fulfillment_terms_defined", "external_dependencies_disclosed",
    "constitution_satisfied",
]
FULFILLMENT_FIELDS = [
    "material_terms_satisfied", "completion_evidence_sufficient",
]
DELEGATION_FIELDS = [
    "purpose_is_subset", "permitted_activity_is_subset", "forbidden_activity_not_weakened",
    "counterparty_scope_not_expanded", "evidence_requirements_not_weakened",
    "fulfillment_requirements_not_weakened", "parent_constitution_preserved",
]
BAD_VALUES = [None, 0, 1, "true", "false", "", {}, []]


def _authorization():
    return {"schema": "pavel-authorization-v2", **{field: True for field in AUTH_FIELDS}}


def _fulfillment():
    return {"schema": "pavel-fulfillment-v2", **{field: True for field in FULFILLMENT_FIELDS}}


def _delegation():
    return {"schema": "pavel-delegation-v1", "explanation": "bounded", **{field: True for field in DELEGATION_FIELDS}}


@pytest.mark.parametrize("field", AUTH_FIELDS)
@pytest.mark.adversarial
def test_every_authorization_boolean_rejects_omission_and_non_boolean_types(direct_vm, direct_deploy, field):
    direct_vm.warp("2030-01-01T00:00:00Z")
    core = direct_deploy("contracts/pavel_core.py")
    missing = _authorization()
    missing.pop(field)
    assert core._auth_valid(missing) is False
    for bad in BAD_VALUES:
        candidate = _authorization()
        candidate[field] = bad
        assert core._auth_valid(candidate) is False


@pytest.mark.parametrize("field", FULFILLMENT_FIELDS)
@pytest.mark.adversarial
def test_every_fulfillment_boolean_rejects_omission_and_non_boolean_types(direct_vm, direct_deploy, field):
    direct_vm.warp("2030-01-01T00:00:00Z")
    core = direct_deploy("contracts/pavel_core.py")
    missing = _fulfillment()
    missing.pop(field)
    assert core._fulfillment_valid(missing) is False
    for bad in BAD_VALUES:
        candidate = _fulfillment()
        candidate[field] = bad
        assert core._fulfillment_valid(candidate) is False


@pytest.mark.parametrize("field", DELEGATION_FIELDS)
@pytest.mark.adversarial
def test_every_delegation_boolean_rejects_omission_and_non_boolean_types(direct_vm, direct_deploy, field):
    direct_vm.warp("2030-01-01T00:00:00Z")
    core = direct_deploy("contracts/pavel_core.py")
    missing = _delegation()
    missing.pop(field)
    assert core._valid_vector(missing, DELEGATION_FIELDS) is False
    for bad in BAD_VALUES:
        candidate = _delegation()
        candidate[field] = bad
        assert core._valid_vector(candidate, DELEGATION_FIELDS) is False


@pytest.mark.adversarial
def test_consensus_schemas_reject_extra_keys_and_accept_reordered_keys(direct_vm, direct_deploy):
    direct_vm.warp("2030-01-01T00:00:00Z")
    core = direct_deploy("contracts/pavel_core.py")
    for value, validator in ((_authorization(), core._auth_valid), (_fulfillment(), core._fulfillment_valid)):
        extra = dict(value)
        extra["unexpected"] = True
        assert validator(extra) is False
        reordered = {key: value[key] for key in reversed(list(value.keys()))}
        assert validator(reordered) is True
    delegation = _delegation()
    delegation["unexpected"] = True
    assert core._valid_vector(delegation, DELEGATION_FIELDS) is False


@pytest.mark.adversarial
def test_dispute_schema_rejects_missing_wrong_types_extra_keys_and_bad_outcomes(direct_vm, direct_deploy):
    direct_vm.warp("2030-01-01T00:00:00Z")
    core = direct_deploy("contracts/pavel_core.py")
    valid = {"schema": "pavel-dispute-v1", "outcome": "RELEASE_TO_COUNTERPARTY", "explanation": "bounded", "original_outcome_supported": True, "challenge_supported": True, "response_sufficient": True, "evidence_sufficient": True}
    for field in ("original_outcome_supported", "challenge_supported", "response_sufficient", "evidence_sufficient"):
        missing = dict(valid)
        missing.pop(field)
        assert core._dispute_valid(missing) is False
    for value in BAD_VALUES:
        candidate = dict(valid)
        candidate["challenge_supported"] = value
        assert core._dispute_valid(candidate) is False
    extra = dict(valid)
    extra["unexpected"] = True
    assert core._dispute_valid(extra) is False
    invalid_outcome = dict(valid)
    invalid_outcome["outcome"] = "SETTLE_ANY_AMOUNT"
    assert core._dispute_valid(invalid_outcome) is False
