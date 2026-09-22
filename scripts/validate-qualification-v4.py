"""Validate the frozen qualification-v4 fixture and provenance files without network writes."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts" / "studionet" / "qualification-v4"
EXPECTED = "0xcb5a845638cbc1f95d7f8343278685682c3ba13f"
CORE_SHA = "6ece0d1aae99ccbd734b97802c9ca2481a38264da593b43ca8a5d7ab188c7053"
VAULT_SHA = "d967d6f1e70cd698fc428338ca822c5541ce07fd7977517db7bb19f9796aa8ed"


def load(name: str):
    return json.loads((ARTIFACTS / name).read_text(encoding="utf-8"))


fixture = load("qualification-fixture.json")
assert fixture["qualificationVersion"] == "qualification-v4"
assert fixture["network"] == "studionet" and fixture["chainId"] == 61999
for field in ("principal", "agent", "counterpartyWallet"):
    assert fixture[field].lower() == EXPECTED
assert fixture["authority"] == "docs.genlayer.com"
assert fixture["evidenceUrl"].startswith("https://docs.genlayer.com/")
assert fixture["validFrom"] < fixture["expiresAt"]
assert fixture["maximumSingleTransaction"] == fixture["epochBudget"] == fixture["totalBudget"] == 1
for phrase in ("recurring", "subscription", "token purchase", "unrelated service", "alternate recipient"):
    assert phrase in fixture["forbiddenActivity"].lower()
for field in ("purpose", "permittedActivity", "forbiddenActivity", "evidencePolicy", "fulfillmentPolicy", "recoveryPolicy", "commercialTerms", "fulfillmentCriteria"):
    assert isinstance(fixture[field], str) and fixture[field]

freeze = load("source-freeze.json")
assert freeze["qualificationVersion"] == "qualification-v4"
assert freeze["core"]["sha256"] == CORE_SHA
assert freeze["vault"]["sha256"] == VAULT_SHA
assert hashlib.sha256((ROOT / "contracts" / "pavel_core.py").read_bytes()).hexdigest() == CORE_SHA
assert hashlib.sha256((ROOT / "contracts" / "pavel_vault.py").read_bytes()).hexdigest() == VAULT_SHA

print("QUALIFICATION_V4_FIXTURE: passed (frozen identity, authority, validity, economic bounds, and policy prohibitions)")
print("QUALIFICATION_V4_SOURCE_FREEZE: passed")
