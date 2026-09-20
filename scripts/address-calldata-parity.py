"""Static gate for stable Studionet Address calldata boundaries.

The companion Direct Mode suite passes v0.2.16 ``Address`` objects through the
same calldata roundtrip used by the local harness. This gate protects the
source/schema contract from regressing to unconditional Address(Address(...))
normalization.
"""

from __future__ import annotations

import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _functions(path: Path) -> dict[str, ast.FunctionDef]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    return {
        node.name: node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }


def _annotation(function: ast.FunctionDef, name: str) -> str:
    for argument in (*function.args.posonlyargs, *function.args.args, *function.args.kwonlyargs):
        if argument.arg == name:
            return ast.unparse(argument.annotation) if argument.annotation else ""
    raise AssertionError(f"missing parameter {name} in {function.name}")


def _has_existing_address_branch(function: ast.FunctionDef, parameter: str) -> bool:
    for node in ast.walk(function):
        if not isinstance(node, (ast.If, ast.IfExp)):
            continue
        condition = ast.unparse(node.test)
        if f"isinstance({parameter}, Address)" in condition or "isinstance(value, Address)" in condition:
            return True
    return False


def main() -> int:
    core_path = ROOT / "contracts" / "pavel_core.py"
    vault_path = ROOT / "contracts" / "pavel_vault.py"
    core = _functions(core_path)
    vault = _functions(vault_path)

    required_core = {
        "register_agent": "agent_address",
        "register_counterparty": "bound_wallet",
        "set_vault_address": "vault_address",
        "create_mandate": "authorized_agent",
        "create_intent": "recipient",
    }
    for method, parameter in required_core.items():
        assert _annotation(core[method], parameter) == "Address", f"Core.{method}.{parameter} is not Address-typed"

    assert _annotation(vault["__init__"], "core_address") == "Address", "Vault constructor is not Address-typed"
    assert _has_existing_address_branch(vault["__init__"], "core_address"), "Vault constructor lacks existing-Address normalization"
    assert _has_existing_address_branch(vault["_address"], "value"), "Vault address helper lacks existing-Address normalization"
    assert "core = Address(core_address)\n" not in vault_path.read_text(encoding="utf-8")

    print("ADDRESS_CALLDATA_PARITY: passed (Vault constructor/helper and 5 Core address parameters)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
