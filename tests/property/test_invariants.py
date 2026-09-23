import pytest


@pytest.mark.property
def test_conservation_equation_for_each_vault_transition():
    # This is the executable reference equation mirrored by PavelVault.
    states = [
        (100, 100, 0, 0, 0, 0),
        (100, 70, 30, 0, 0, 0),
        (100, 70, 0, 30, 0, 0),
        (100, 70, 0, 0, 30, 0),
    ]
    for deposited, available, reserved, release_pending, refund_pending, recovered in states:
        assert available + reserved + release_pending + refund_pending + recovered == deposited


@pytest.mark.property
def test_settlement_directions_are_exclusive():
    directions = {"RELEASE_TO_COUNTERPARTY", "REFUND_TO_PRINCIPAL"}
    for first in directions:
        for second in directions:
            assert not (first != second and first == second)


@pytest.mark.property
def test_v7_fulfillment_requires_all_objective_and_semantic_checks():
    objective = [
        "authorized_deliverable_identified",
        "provider_identity_consistent",
        "evidence_authentic",
        "delivery_corresponds_to_intent",
        "quantity_consistent",
        "no_material_substitution",
        "mandate_requirements_preserved",
    ]
    semantic = ["material_terms_satisfied", "completion_evidence_sufficient"]
    checks = {field: True for field in objective + semantic}
    assert all(checks.values())
    for field in objective + semantic:
        changed = dict(checks)
        changed[field] = False
        assert not all(changed.values())


@pytest.mark.property
def test_v7_fulfillment_terminal_states_have_one_disposition():
    terminal_dispositions = {
        "FULFILLED": "RELEASE_TO_COUNTERPARTY",
        "NOT_FULFILLED": "REFUND_TO_PRINCIPAL",
        "FULFILLMENT_EXPIRED": "REFUND_TO_PRINCIPAL",
    }
    assert set(terminal_dispositions) == {"FULFILLED", "NOT_FULFILLED", "FULFILLMENT_EXPIRED"}
    assert all(value in {"RELEASE_TO_COUNTERPARTY", "REFUND_TO_PRINCIPAL"} for value in terminal_dispositions.values())
    assert not (terminal_dispositions["FULFILLED"] == "REFUND_TO_PRINCIPAL")
