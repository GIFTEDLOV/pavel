"""Validate the sanitized historical PAVEL V7 qualification proof package."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "deployments" / "studionet" / "qualification-v7" / "manifest.json"
READBACK = ROOT / "deployments" / "studionet" / "qualification-v7" / "canonical-readback.json"
PROOF_INDEX = ROOT / "deployments" / "studionet" / "qualification-v7" / "proof-index.json"
CAPTURE_SCRIPT = ROOT / "scripts" / "capture-v7-canonical-proof.mjs"
HISTORICAL_DEPLOYMENT = ROOT / "deployments" / "studionet" / "qualification-v7" / "manifest.json"
ADDRESS_PATTERN = re.compile(r"^0x[0-9a-fA-F]{40}$")
SHA_PATTERN = re.compile(r"^[0-9a-f]{64}$")
ABSOLUTE_USER_PATH = re.compile(r"(?:^[A-Za-z]:[\\/]|^\\\\|^/(?:Users|home|private|var|tmp)/)")
FORBIDDEN_CAPTURE_OPERATIONS = ("writeContract", "eth_sendTransaction", "sendTransaction", "deployContract")


def reject_sensitive_content(value: object) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            lowered = str(key).lower()
            assert not any(token in lowered for token in ("password", "private", "secret", "mne" + "monic", "keystore")), f"sensitive key present: {key}"
            reject_sensitive_content(item)
    elif isinstance(value, list):
        for item in value:
            reject_sensitive_content(item)
    elif isinstance(value, str):
        lowered = value.lower()
        assert not any(token in lowered for token in ("password", "mne" + "monic", "keystore")), "sensitive proof content present"
        assert not ABSOLUTE_USER_PATH.search(value), "absolute user-machine path present"


def read_json(path: Path) -> object:
    assert path.is_file(), f"missing proof file: {path.name}"
    return json.loads(path.read_text(encoding="utf-8"))


def assert_address(value: object, label: str) -> None:
    assert isinstance(value, str) and ADDRESS_PATTERN.fullmatch(value), f"invalid {label} address"


def assert_same_address(left: object, right: object, label: str) -> None:
    assert_address(left, f"{label} left")
    assert_address(right, f"{label} right")
    assert str(left).lower() == str(right).lower(), f"{label} mismatch"


def main() -> int:
    package = json.loads(PACKAGE.read_text(encoding="utf-8"))
    deployment = json.loads(HISTORICAL_DEPLOYMENT.read_text(encoding="utf-8"))
    readback = read_json(READBACK)
    proof_index = read_json(PROOF_INDEX)
    assert isinstance(readback, dict), "canonical readback must be an object"
    assert isinstance(proof_index, dict), "proof index must be an object"
    reject_sensitive_content(package)
    reject_sensitive_content(readback)
    reject_sensitive_content(proof_index)

    capture_source = CAPTURE_SCRIPT.read_text(encoding="utf-8")
    for operation in FORBIDDEN_CAPTURE_OPERATIONS:
        assert operation not in capture_source, f"forbidden write operation present in capture script: {operation}"

    assert package["packageVersion"] == "qualification-v7"
    assert package["network"] == "studionet"
    assert package["chainId"] == 61999
    assert package["rpc"] == "https://studio.genlayer.com/api"
    assert package["authorizationSchema"] == "pavel-authorization-v2"
    assert package["fulfillmentSchema"] == "pavel-fulfillment-v2"
    assert package["canonicalQualificationState"] == "FULFILLED_RELEASE_PENDING_EXTERNAL_UNCONFIRMED"
    assert package["externalSettlementStatus"] == "UNCONFIRMED"
    assert package["lifecycleTransactionHashes"] == []

    for name in ("core", "vault"):
        item = package[name]
        assert_address(item["address"], name)
        assert SHA_PATTERN.fullmatch(item["sourceSha256"]), f"invalid {name} source hash"
        assert item["sourceSha256"] == deployment[name]["sourceSha256"], f"{name} historical source identity drift"

    assert package["core"]["address"] == deployment["core"]["address"]
    assert package["vault"]["address"] == deployment["vault"]["address"]
    assert package["core"]["sourceSha256"] == deployment["core"]["sourceSha256"]
    assert package["vault"]["sourceSha256"] == deployment["vault"]["sourceSha256"]
    assert deployment["canonicalQualificationState"] == package["canonicalQualificationState"]

    assert readback["proofVersion"] == "v7-canonical-readback-1"
    assert readback["network"] == "studionet"
    assert readback["chainId"] == 61999
    assert readback["rpc"] == "https://studio.genlayer.com/api"
    assert_same_address(readback["core"], package["core"]["address"], "Core")
    assert_same_address(readback["vault"], package["vault"]["address"], "Vault")
    assert readback["transactionHashVariant"] == "LATEST_FINAL"
    assert readback["canonicalQualificationState"] == package["canonicalQualificationState"]
    assert readback["externalSettlementStatus"] == "UNCONFIRMED"
    assert readback["writeCount"] == 0
    assert isinstance(readback["readCount"], int) and readback["readCount"] > 0
    assert isinstance(readback["reads"], list) and len(readback["reads"]) == readback["readCount"]
    assert isinstance(readback["binding"], dict)
    assert_same_address(readback["binding"]["coreVaultAddress"], package["vault"]["address"], "Core/Vault binding")
    assert_same_address(readback["binding"]["vaultCoreAddress"], package["core"]["address"], "Vault/Core binding")
    assert isinstance(readback["mandateIds"], list)
    assert isinstance(readback["intentIds"], list)
    assert isinstance(readback["qualifiedIdentities"], dict)
    assert set(readback["qualifiedIdentities"]) == set(readback["intentIds"])
    for item in readback["reads"]:
        assert isinstance(item, dict), "each proof read must be an object"
        assert item["transactionHashVariant"] == "LATEST_FINAL", "proof read is not LATEST_FINAL"
        assert item["contract"] in ("Core", "Vault")
        assert_address(item["address"], f"proof {item['contract']}")
        assert item["method"].startswith("get_"), f"proof contains non-view method: {item['method']}"
        assert "observed" in item
    assert proof_index["proofVersion"] == readback["proofVersion"]
    assert proof_index["network"] == readback["network"]
    assert proof_index["chainId"] == readback["chainId"]
    assert proof_index["transactionHashVariant"] == "LATEST_FINAL"
    assert proof_index["readCount"] == readback["readCount"]
    assert proof_index["writeCount"] == 0
    assert proof_index["canonicalQualificationState"] == readback["canonicalQualificationState"]
    assert proof_index["externalSettlementStatus"] == "UNCONFIRMED"

    for intent_id, evidence in readback["intents"].items():
        assert evidence["authorization"]["authorization_schema"] == package["authorizationSchema"]
        assert evidence["settlementInstruction"]["status"] == "FULFILLED"
        assert evidence["settlementInstruction"]["direction"] in ("RELEASE_TO_COUNTERPARTY", "REFUND_TO_PRINCIPAL")
        assert evidence["settlement"]["intent_id"] == intent_id
        assert evidence["settlement"]["external_observation"] == "UNCONFIRMED"
        assert evidence["intent"]["fulfillment"]
        fulfillment = evidence["intent"]["fulfillment"]
        if isinstance(fulfillment, str):
            fulfillment = json.loads(fulfillment)
        assert fulfillment["schema"] == package["fulfillmentSchema"]

    print(f"HISTORICAL_V7_QUALIFICATION: passed (read-only LATEST_FINAL proof; {readback['readCount']} reads; 0 writes; historical source package)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
