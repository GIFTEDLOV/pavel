"""Validate the sanitized current PAVEL V7 qualification proof package."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "deployments" / "studionet" / "qualification-v7" / "manifest.json"
DEPLOYMENT = ROOT / "deployments" / "studionet" / "manifest.json"
CORE_SOURCE = ROOT / "contracts" / "pavel_core.py"
VAULT_SOURCE = ROOT / "contracts" / "pavel_vault.py"
ADDRESS_PATTERN = re.compile(r"^0x[0-9a-fA-F]{40}$")
SHA_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def reject_sensitive_keys(value: object) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            lowered = str(key).lower()
            assert not any(token in lowered for token in ("password", "private", "secret", "keystore")), f"sensitive key present: {key}"
            reject_sensitive_keys(item)
    elif isinstance(value, list):
        for item in value:
            reject_sensitive_keys(item)


def main() -> int:
    package = json.loads(PACKAGE.read_text(encoding="utf-8"))
    deployment = json.loads(DEPLOYMENT.read_text(encoding="utf-8"))
    reject_sensitive_keys(package)

    assert package["packageVersion"] == "qualification-v7"
    assert package["network"] == "studionet"
    assert package["chainId"] == 61999
    assert package["rpc"] == "https://studio.genlayer.com/api"
    assert package["authorizationSchema"] == "pavel-authorization-v2"
    assert package["fulfillmentSchema"] == "pavel-fulfillment-v2"
    assert package["canonicalQualificationState"] == "FULFILLED_RELEASE_PENDING_EXTERNAL_UNCONFIRMED"
    assert package["externalSettlementStatus"] == "UNCONFIRMED"
    assert package["lifecycleTransactionHashes"] == []

    for name, source in (("core", CORE_SOURCE), ("vault", VAULT_SOURCE)):
        item = package[name]
        assert ADDRESS_PATTERN.fullmatch(item["address"]), f"invalid {name} address"
        assert SHA_PATTERN.fullmatch(item["sourceSha256"]), f"invalid {name} source hash"
        assert item["sourceSha256"] == sha256_file(source), f"{name} source hash drift"

    assert package["core"]["address"] == deployment["coreAddress"]
    assert package["vault"]["address"] == deployment["vaultAddress"]
    assert package["core"]["sourceSha256"] == deployment["sourceHashes"]["core"]
    assert package["vault"]["sourceSha256"] == deployment["sourceHashes"]["vault"]
    assert deployment["qualificationState"] == package["canonicalQualificationState"]
    print("CURRENT_V7_QUALIFICATION: passed (sanitized proof package; lifecycle hashes intentionally omitted)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
