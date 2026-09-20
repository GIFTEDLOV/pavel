"""Validate local qualification-v2 JSON evidence without contacting the network."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts" / "studionet" / "qualification-v2"


def main() -> int:
    required = {
        "failed-create-mandate-empty-arg.json",
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

    proof = json.loads((ARTIFACTS / "call-data-proof.json").read_text(encoding="utf-8"))
    assert proof["argumentCount"] == 2
    assert proof["arg0Type"] == "Address"
    assert proof["arg1Type"] == "string"
    assert proof["arg1Value"] == ""
    assert proof["emptyStringPreserved"] is True

    print(f"QUALIFICATION_ARTIFACT_JSON: passed ({len(present)} JSON files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
