"""Static Core/Vault interface parity gate.

The Direct Mode harness used by this repository does not route two deployed
Intelligent Contracts in one VM. This gate therefore compares every typed
cross-contract view against the concrete public view signature in the target
source before any deployment qualification.
"""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "contracts" / "pavel_core.py"
VAULT = ROOT / "contracts" / "pavel_vault.py"


def _signature(source: str, method: str) -> tuple[str, str]:
    pattern = rf"^\s*def\s+{re.escape(method)}\(([^)]*)\)\s*->\s*([^:]+):"
    match = re.search(pattern, source, re.MULTILINE)
    if not match:
        raise AssertionError(f"missing method {method}")
    args = re.sub(r"\s+", "", match.group(1))
    return args, match.group(2).strip()


def _interface_methods(source: str, class_name: str) -> dict[str, tuple[str, str]]:
    class_match = re.search(rf"class\s+{class_name}:\n(?P<body>.*?)(?=\n\nclass\s|\nclass\s|\Z)", source, re.DOTALL)
    if not class_match:
        raise AssertionError(f"missing interface {class_name}")
    body = class_match.group("body")
    return {
        name: (re.sub(r"\s+", "", args), result.strip())
        for name, args, result in re.findall(r"^\s*def\s+(\w+)\(([^)]*)\)\s*->\s*([^:]+):", body, re.MULTILINE)
    }


def main() -> int:
    core_source = CORE.read_text(encoding="utf-8")
    vault_source = VAULT.read_text(encoding="utf-8")
    expected_vault = _interface_methods(core_source, "VaultInterface")
    expected_core = _interface_methods(vault_source, "CoreInterface")
    for method, expected in expected_vault.items():
        actual = _signature(vault_source, method)
        if actual != expected:
            raise SystemExit(f"Vault.{method} mismatch: expected {expected}, found {actual}")
    for method, expected in expected_core.items():
        actual = _signature(core_source, method)
        if actual != expected:
            raise SystemExit(f"Core.{method} mismatch: expected {expected}, found {actual}")
    print(f"CORE_VAULT_INTERFACE_PARITY: passed ({len(expected_vault)} Vault views, {len(expected_core)} Core views)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
