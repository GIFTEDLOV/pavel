"""Reject deployment manifests that imply an undeclared live deployment."""

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
        "deployed": False,
        "coreAddress": None,
        "vaultAddress": None,
        "sourceHashes": {},
    }
    if data != required:
        raise SystemExit(f"deployment manifest is not an undeployed honest placeholder: {data!r}")
    print("DEPLOYMENT_MANIFEST_HONESTY: passed (explicit undeployed Studionet placeholder only)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
