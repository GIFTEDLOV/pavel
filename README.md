# PAVEL

PAVEL (Policy-governed Autonomous Value Execution Layer) is a GenLayer Studionet foundation for constitutional agent authority, deterministic GEN custody, evidence authentication, fulfillment adjudication, and dispute-aware settlement.

Phase 1 is local-only. It contains two authoritative Intelligent Contracts:

- `contracts/pavel_core.py` — principals, agents, sealed Mandates, delegation, frozen Intents, evidence definitions and snapshots, semantic results, disputes, and deterministic settlement instructions.
- `contracts/pavel_vault.py` — payable GEN custody, reservations, budgets, conservation accounting, replay protection, and pending external settlement.

The browser client is deliberately chain-state honest: it reads Core and Vault, persists the returned GenLayer transaction ID immediately, resumes polling for that same ID, separates protocol finality from execution success, and does not claim external EOA transfer completion from parent finalization alone.

Evidence transport is separate from committed evidence identity. Approved recovery URLs can only reproduce the exact committed SHA-256 and byte length under sealed authority constraints. Core also accepts bounded permissionless challenges: every challenge has its own evidence, snapshot, result, and resolution state, and any unresolved qualifying challenge blocks settlement.

## Local verification

```powershell
\.venv\Scripts\pytest.exe -q
\.venv\Scripts\genvm-lint.exe check contracts\pavel_core.py --json
\.venv\Scripts\genvm-lint.exe check contracts\pavel_vault.py --json
\.venv\Scripts\genvm-lint.exe schema contracts\pavel_core.py --json
\.venv\Scripts\genvm-lint.exe typecheck contracts\pavel_core.py --json
\.venv\Scripts\genvm-lint.exe typecheck contracts\pavel_vault.py --json
node tools/qualification/validate-manifest.mjs
pnpm --dir frontend install
pnpm --dir frontend typecheck
pnpm --dir frontend lint
pnpm --dir frontend build
node scripts/network-guard.mjs
```

No deployment, faucet request, live transaction, GitHub remote, or GitHub push is part of Phase 1.

## Canonical network

PAVEL V1 targets stable Studionet: `https://studio.genlayer.com/api`, chain `61999`, native `GEN`, explorer `https://explorer-studio.genlayer.com`.

Read the implementation decisions in [`docs/TOOLCHAIN.md`](docs/TOOLCHAIN.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before changing contract or SDK versions.
