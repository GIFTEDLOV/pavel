"""Validate the frozen qualification-v3 plan fixture without network writes."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "artifacts" / "studionet" / "qualification-v3" / "qualification-fixture.json"
EXPECTED = "0xcb5a845638cbc1f95d7f8343278685682c3ba13f"

data = json.loads(FIXTURE.read_text(encoding="utf-8"))
assert data["qualificationVersion"] == "qualification-v3"
assert data["network"] == "studionet" and data["chainId"] == 61999
for field in ("principal", "agent", "counterpartyWallet"):
    assert data[field].lower() == EXPECTED
assert data["authority"] == "docs.genlayer.com"
assert data["evidenceUrl"].startswith("https://docs.genlayer.com/")
assert data["validFrom"] < data["expiresAt"]
assert data["maximumSingleTransaction"] == data["epochBudget"] == data["totalBudget"] == 1
for phrase in ("recurring", "subscription", "token purchase", "unrelated service", "alternate recipient"):
    assert phrase in data["forbiddenActivity"].lower()
for field in ("purpose", "permittedActivity", "forbiddenActivity", "evidencePolicy", "fulfillmentPolicy", "recoveryPolicy", "commercialTerms", "fulfillmentCriteria"):
    assert isinstance(data[field], str) and data[field]
print("QUALIFICATION_V3_FIXTURE: passed (frozen identity, authority, validity, economic bounds, and policy prohibitions)")
