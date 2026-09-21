import json

import pytest

from .conftest import BASE_TIME, address_text


@pytest.mark.direct
def test_vault_binding_is_one_time_and_caller_bound(direct_vm, direct_deploy, direct_owner, direct_bob):
    direct_vm.warp(BASE_TIME)
    core_address = "0x" + "11" * 20
    vault = direct_deploy("contracts/pavel_vault.py", core_address)
    assert vault.get_core_address() == core_address.lower()
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only the deployment binding admin may bind Core"):
        vault.bind_core()
    direct_vm.sender = direct_owner
    vault.bind_core()
    assert vault.get_core_address() == core_address.lower()
    with direct_vm.expect_revert("Core binding is immutable"):
        vault.bind_core()


@pytest.mark.direct
def test_vault_rejects_zero_deposit_before_any_accounting_transition(direct_vm, direct_deploy, direct_owner):
    direct_vm.warp(BASE_TIME)
    core_address = "0x" + "11" * 20
    vault = direct_deploy("contracts/pavel_vault.py", core_address)
    vault.bind_core()
    direct_vm.value = 0
    with direct_vm.expect_revert("deposit must be positive"):
        vault.deposit("M-1")
    accounting = json.loads(vault.get_global_accounting())
    assert accounting["deposited"] == "0"
    assert accounting["available"] == "0"
    assert accounting["conserved"] is True


@pytest.mark.direct
def test_vault_accepts_fractional_backend_datetime_for_timestamped_deposit(direct_vm, direct_deploy, direct_owner):
    direct_vm.warp("2030-01-01T00:00:00.123456+00:00")
    mandate_id = "M-1"
    core_address = "0x" + "11" * 20
    vault = direct_deploy("contracts/pavel_vault.py", core_address)
    vault.bind_core()

    class FakeCore:
        def view(self):
            return self

        def get_mandate(self, requested_mandate):
            if requested_mandate != mandate_id:
                return json.dumps({})
            return json.dumps({"mandate_id": mandate_id, "status": "SEALED", "principal": address_text(direct_owner)})

    vault._core = lambda: FakeCore()
    direct_vm.sender = direct_owner
    direct_vm.value = 1
    vault.deposit(mandate_id)
    accounting = json.loads(vault.get_accounting(mandate_id))
    assert accounting["deposited"] == "1"
    assert accounting["conserved"] is True
