"""Validate local qualification-v2 JSON evidence without contacting the network."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts" / "studionet" / "qualification-v2"


def main() -> int:
    required = {
        "failed-create-mandate-empty-arg.json",
        "failed-create-mandate-empty-equals.json",
        "call-data-proof.json",
        "empty-string-boundary-audit.json",
        "transactions.json",
    }
    present = {p.name for p in ARTIFACTS.glob("*.json")}
    missing = required - present
    assert not missing, f"missing qualification evidence: {sorted(missing)}"
    for path in sorted(ARTIFACTS.glob("*.json")):
        json.loads(path.read_text(encoding="utf-8"))

    failed = json.loads((ARTIFACTS / "failed-create-mandate-empty-arg.json").read_text(encoding="utf-8"))
    assert failed["status"] == "FINALIZED"
    assert failed["execution"] == "ERROR"
    assert failed["stateProof"]["stateHashEqual"] is True
    assert failed["stateMutation"] == "NONE"

    second = json.loads((ARTIFACTS / "failed-create-mandate-empty-equals.json").read_text(encoding="utf-8"))
    assert second["status"] == "FINALIZED"
    assert second["execution"] == "ERROR"
    assert second["nonce"] == 176
    assert second["actualCalldataSemantic"]["args"][1] == 0
    assert second["error"]["message"] == "parent mandate id must be text"
    assert second["rollback"] == "parent mandate id must be text"
    assert second["stateMutation"] == "NONE"
    assert second["stateProof"]["stateHashEqual"] is True
    assert second["finalizedReadbacks"]["get_mandate_count"] == 0
    assert second["finalizedReadbacks"]["get_intent_count"] == 0

    proof = json.loads((ARTIFACTS / "call-data-proof.json").read_text(encoding="utf-8"))
    assert proof["cliExactEmptyStringSupported"] is False
    assert proof["sdkFallbackRequired"] is True
    sdk = proof["sdk"]
    assert sdk["argumentCount"] == 2
    assert sdk["arg0Type"] == "Address"
    assert sdk["arg1Type"] == "string"
    assert sdk["arg1Value"] == ""
    assert sdk["arg1Utf8Length"] == 0
    assert sdk["emptyStringPreserved"] is True
    assert any(c["name"] == "explicit-empty-option" and c["parserSecondValue"] == 0 for c in proof["cliCandidates"])

    transactions = json.loads((ARTIFACTS / "transactions.json").read_text(encoding="utf-8"))
    assert transactions["nextDeployerNonce"] == {"latest": 177, "pending": 177}
    assert any(item["tx"] == "0x7eb6175aab8a0cfdfc820a7e3a17f4769655e7d170feb3adce1b26b4622dd6f1" and item["nonce"] == 176 and item["execution"] == "ERROR" for item in transactions["transactions"])

    print(f"QUALIFICATION_ARTIFACT_JSON: passed ({len(present)} JSON files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
