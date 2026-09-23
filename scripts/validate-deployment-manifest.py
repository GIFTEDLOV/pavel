"""Validate the active PAVEL V7 deployment manifest."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "deployments" / "studionet" / "manifest.json"


def main() -> int:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    required = {
        "network": "studionet",
        "rpc": "https://studio.genlayer.com/api",
        "chainId": 61999,
        "currency": "GEN",
        "explorer": "https://explorer-studio.genlayer.com",
        "deployed": True,
        "version": "V7",
        "coreAddress": "0xBA2356FfE5062506FA938da4715c03a2BE7929bF",
        "vaultAddress": "0x552167Cc0883D02ce42fA2aD64E29Cd10EE3eDFD",
        "sourceHashes": {
            "core": "4acc04c4b684b35058b793973eec75569af9e981eb84d33167198615255b785a",
            "vault": "f671005e07a658a17a7711807d23fa56bf0d6e2e85d0a266eafc17b03455f15c",
        },
        "authorizationSchema": "pavel-authorization-v2",
        "fulfillmentSchema": "pavel-fulfillment-v2",
        "qualificationState": "FULFILLED_RELEASE_PENDING_EXTERNAL_UNCONFIRMED",
    }
    if data != required:
        raise SystemExit(f"deployment manifest does not match verified PAVEL V7: {data!r}")
    print("DEPLOYMENT_MANIFEST: passed (verified PAVEL V7 Studionet deployment)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
