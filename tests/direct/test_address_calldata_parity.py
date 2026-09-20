"""Live-qualification regression coverage for GenLayer Address calldata."""

import json
from pathlib import Path

import pytest

from .conftest import BASE_TIME, configure_and_seal_core


def runtime_address(contract_path: str, raw: bytes):
    """Construct the stable v0.2.16 runtime Address used by live calldata."""
    from gltest.direct.sdk_loader import setup_sdk_paths

    setup_sdk_paths(Path(contract_path).resolve(), "v0.2.16")
    from genlayer.py.types import Address

    return Address(raw)


@pytest.mark.direct
def test_vault_constructor_accepts_runtime_address_object_and_preserves_core(
    direct_vm, direct_deploy, direct_owner
):
    direct_vm.warp(BASE_TIME)
    runtime_core = runtime_address("contracts/pavel_vault.py", direct_owner)
    vault = direct_deploy("contracts/pavel_vault.py", runtime_core)
    assert type(vault.core_address).__name__ == "Address"
    assert vault.get_core_address() == runtime_core.as_hex.lower()


@pytest.mark.direct
def test_vault_constructor_rejects_zero_runtime_address(direct_vm, direct_deploy, direct_owner):
    direct_vm.warp(BASE_TIME)
    zero_address = runtime_address("contracts/pavel_vault.py", b"\x00" * 20)
    with direct_vm.expect_revert("Core address cannot be zero"):
        direct_deploy("contracts/pavel_vault.py", zero_address)


@pytest.mark.direct
def test_vault_constructor_rejects_malformed_address(direct_vm, direct_deploy):
    direct_vm.warp(BASE_TIME)
    with pytest.raises(Exception, match="invalid address"):
        direct_deploy("contracts/pavel_vault.py", "not-an-address")


@pytest.mark.direct
def test_vault_address_normalizer_never_double_wraps_address(
    direct_vm, direct_deploy, direct_owner
):
    direct_vm.warp(BASE_TIME)
    runtime_core = runtime_address("contracts/pavel_vault.py", direct_owner)
    vault = direct_deploy("contracts/pavel_vault.py", runtime_core)
    assert vault._address(runtime_core) == runtime_core
    assert vault._address(runtime_core.as_hex).as_hex.lower() == runtime_core.as_hex.lower()


@pytest.mark.direct
def test_core_security_critical_address_parameters_accept_runtime_addresses(
    direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob
):
    direct_vm.warp(BASE_TIME)
    core = direct_deploy("contracts/pavel_core.py")

    direct_vm.sender = direct_owner
    core.register_principal()
    alice = runtime_address("contracts/pavel_core.py", direct_alice)
    bob = runtime_address("contracts/pavel_core.py", direct_bob)
    owner = runtime_address("contracts/pavel_core.py", direct_owner)
    core.register_agent(alice, "operations-agent")
    counterparty_id = core.register_counterparty(
        bob, "provider", "https://evidence.example"
    )
    mandate_id = configure_and_seal_core(
        core, direct_vm, direct_owner, direct_alice
    )

    core.set_vault_address(bob)
    assert json.loads(core.get_counterparty(counterparty_id))["bound_wallet"] == bob.as_hex.lower()
    assert core.get_vault_address() == bob.as_hex.lower()

    direct_vm.sender = direct_alice
    intent_id = core.create_intent(
        mandate_id,
        counterparty_id,
        owner,
        3 * 10**18,
        "GPU provider quote",
        "Purchase Linux GPU infrastructure for Project Atlas",
        "One month of ML-suitable Linux GPU infrastructure",
        "Provider quote, amount, and service period",
        "Provisioned instance with quoted GPU capacity",
        1924992000 - 3600,
    )
    assert json.loads(core.get_intent(intent_id))["recipient"] == owner.as_hex.lower()
