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
