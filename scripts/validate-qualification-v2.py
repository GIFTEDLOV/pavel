"""Validate the versioned qualification-v2 manifest without promoting it."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "deployments" / "studionet" / "qualification-v2" / "qualification-manifest.json"
OLD = {"0x572773e2ab38aa5a546bcfc50be25f209fb19159", "0x93541666268fcc02a2087b9275731aabeb78826f"}


def main() -> int:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    network = data["network"]
    assert data["qualificationVersion"] == "qualification-v2"
    assert data["qualificationOnly"] is True
    assert network["alias"] == "studionet"
    assert network["rpc"] == "https://studio.genlayer.com/api"
    assert network["chainId"] == 61999
    assert data["sourceHashes"] == {
        "core": "d3ad610319a175041b5d993826a1845e04a3feb4e59082be819859967b858259",
        "vault": "29fd8a384813617b7d37226438b5bb31429ad6e12e81a3ada210429cebf7a794",
    }
    for key in ("coreAddress", "vaultAddress"):
        value = data[key]
        if isinstance(value, str):
            assert value.lower() not in OLD, f"{key} reuses qualification-v1 address"
    for entry in data["deployTransactions"]:
        assert entry["sourceSha256"] == data["sourceHashes"][entry["kind"].replace("Pavel", "").lower()]
    print(f"QUALIFICATION_V2_MANIFEST: passed (conclusion={data['qualificationConclusion']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
