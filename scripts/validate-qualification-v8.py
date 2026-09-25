"""Validate the tracked, sanitized PAVEL V8 qualification proof package."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / "deployments" / "studionet" / "qualification-v8"
CORE_SHA = "1636cc81461b5536103add686586308a05f599740a4e625e00825d8d11401e60"
VAULT_SHA = "f671005e07a658a17a7711807d23fa56bf0d6e2e85d0a266eafc17b03455f15c"
CORE = "0x1540cEa5d3Df622068B2d3A22aac8Bcb31B900f4"
VAULT = "0xac43A164AB9e82d7Af387059c04579FE48050fce"


def load(name: str) -> dict:
    return json.loads((PROOF / name).read_text(encoding="utf-8"))


def main() -> int:
    deployment = load("deployment.json")
    lifecycle = load("lifecycle.json")
    fulfillment = load("fulfillment-gate.json")
    challenge = load("challenge-flow.json")
    accounting = load("final-accounting.json")

    assert deployment["version"] == "V8"
    assert deployment["network"] == "studionet" and deployment["chainId"] == 61999
    assert deployment["core"]["address"] == CORE
    assert deployment["vault"]["address"] == VAULT
    assert deployment["core"]["sha256"] == CORE_SHA
    assert deployment["vault"]["sha256"] == VAULT_SHA
    assert deployment["core"]["sourceParity"]["sha256"] == CORE_SHA
    assert deployment["vault"]["sourceParity"]["sha256"] == VAULT_SHA
    assert deployment["binding"]["coreToVault"].lower() == VAULT.lower()
    assert deployment["binding"]["vaultToCore"].lower() == CORE.lower()

    assert lifecycle["authorization"]["state"]["status"] == "AUTHORIZED"
    assert lifecycle["fulfillment"]["state"]["intent"]["status"] == "FULFILLED"
    assert lifecycle["settlement"]["state"]["reservation"]["status"] == "RELEASE_PENDING"

    assert fulfillment["prematureAssessment"]["liveTransactionSent"] is False
    assert fulfillment["sequenceOneFulfillment"]["canonicalReadback"]["definition"]["sequence"] == "1"
    assert fulfillment["sequenceOneFulfillment"]["canonicalReadback"]["definition"]["evidence_kind"] == "FULFILLMENT"
    captures = fulfillment["sequenceOneFulfillment"]["canonicalReadback"]["snapshot"]["captures"]
    assert any(c["capture_class"] == "AUTHENTICATED" for c in captures)
    assert fulfillment["assessment"]["canonicalReadback"]["intent"]["status"] == "FULFILLED"

    assert challenge["submittedDoesNotBlock"] is True
    assert challenge["settlementBlockedProof"] is True
    assert challenge["expiry"]["liveProof"] == "PASS"
    states = [item["state"] for item in challenge["transitions"]]
    assert states[:5] == ["SUBMITTED", "EVIDENCE_PENDING", "QUALIFYING", "DISPUTED", "CHALLENGE_BLOCKED"]
    assert "EXPIRED" in states
    assert challenge["expiry"]["challenge"]["status"] == "EXPIRED"
    assert challenge["expiry"]["settlement"]["oldest_open_challenge"] == ""
    assert challenge["expiry"]["settlement"]["direction"] == "RELEASE_TO_COUNTERPARTY"

    final = accounting["accounting"]
    assert accounting["conservation"]["conserved"] is True
    assert accounting["conservation"]["reservedAfterSettlementRequest"] is True
    assert final["reserved"] == "0"
    assert accounting["externalObservation"] == "UNCONFIRMED"

    print("QUALIFICATION_V8: passed (source parity, fulfillment gate, challenge block/expiry, settlement accounting)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
