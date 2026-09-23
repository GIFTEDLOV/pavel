# PAVEL

PAVEL (Policy-governed Autonomous Value Execution Layer) is protocol
infrastructure for constitutional agent authority, deterministic GEN custody,
evidence authentication, fulfillment adjudication, and dispute-aware
settlement. It is designed for a principal who wants an agent to act within a
sealed policy, not to receive an unrestricted withdrawal capability.

The two authoritative Intelligent Contracts are deliberately separated:

- `contracts/pavel_core.py` owns principals, agents, Mandates, delegation,
  frozen Intents, evidence identity and snapshots, semantic decisions,
  disputes, and deterministic settlement instructions.
- `contracts/pavel_vault.py` owns payable GEN, reservations, budgets,
  conservation accounting, replay protection, and pending external settlement.

The browser client is chain-state honest. It never presents an unassessed
Intent as approved, persists a returned GenLayer transaction ID before
polling, separates finality from execution success, and does not claim an
external EOA transfer completed merely because its parent transaction
finalized.

Evidence identity is separate from transport: an approved recovery URL may
restore availability only when the exact committed bytes, digest, length,
authority, Intent, Mandate, and policy binding match. Permissionless challenge
records are independent and append-only; only an authenticated qualifying
challenge blocks settlement.

## Local verification

```powershell
$env:GENVM_VERSION='v0.2.16'
\.venv\Scripts\pytest.exe -q
\.venv\Scripts\genvm-lint.exe check contracts\pavel_core.py --json
\.venv\Scripts\genvm-lint.exe check contracts\pavel_vault.py --json
\.venv\Scripts\genvm-lint.exe schema contracts\pavel_core.py --json
\.venv\Scripts\genvm-lint.exe typecheck contracts\pavel_core.py --json
\.venv\Scripts\genvm-lint.exe typecheck contracts\pavel_vault.py --json
node tools/qualification/validate-manifest.mjs
pnpm --dir frontend typecheck
pnpm --dir frontend lint
pnpm --dir frontend build
node scripts/network-guard.mjs
```

GenVM-dependent tests are run serially. A network qualification is separate
from local verification and uses a new versioned artifact directory.

The V7 Core and Vault are now source-verified and bidirectionally bound on
Studionet 61999. A fresh lifecycle reached canonical authorization,
reservation, full-content fulfillment, and a Core-directed release request.
The final contract state is `FULFILLED` / `RELEASE_PENDING`; the external
settlement observation remains explicitly `UNCONFIRMED`.

The earlier qualification-v1 through V6 deployments remain immutable audit
history and are never runtime defaults. The hosted V7 runner uses the pinned
GenLayer CLI keychain cache non-interactively; no encrypted-keystore password
is required by the release runner.

## Canonical network

PAVEL targets stable Studionet: `https://studio.genlayer.com/api`, chain
`61999`, native `GEN`, explorer `https://explorer-studio.genlayer.com`.

## Verified V7 deployment

- Core: `0xBA2356FfE5062506FA938da4715c03a2BE7929bF`
- Vault: `0x552167Cc0883D02ce42fA2aD64E29Cd10EE3eDFD`
- Authorization schema: `pavel-authorization-v2`
- Fulfillment schema: `pavel-fulfillment-v2`

Authorization combines deterministic mandate, intent, evidence, authority, and
budget constraints with validator consensus over the semantic authorization
vector. Fulfillment uses deterministic objective checks plus the two-field
semantic vector `material_terms_satisfied` and
`completion_evidence_sufficient`. Authenticated evidence is complete and
bounded at 4096 bytes; it is never silently truncated. Settlement directions
are issued by Core and enforced by Vault, with timeout/refund recovery and
replay protection. Every qualification transaction is reconciled by terminal
protocol status, execution result, and canonical application readback.

## Architecture

```mermaid
flowchart LR
  Principal -->|sealed Mandate| Core[PavelCore]
  Agent -->|frozen Intent| Core
  Evidence -->|authenticated snapshot| Core
  Core -->|synchronous authorization read| Vault[PavelVault]
  Vault -->|reserve / pending settlement| GEN[(native GEN)]
  Challenge -->|independent evidence| Core
```

Core decides policy and semantic facts; Vault decides deterministic economic
transitions. A Core write does not synchronously write Vault. The protocol uses
pull verification across typed Intelligent Contract views.

## Repository map

`contracts/` contains the authoritative contracts. `tests/` contains Direct
Mode, adversarial, property, and boundary tests. `frontend/` contains the
typed chain client and route shell. `docs/` contains protocol, security,
qualification, release, and provenance records. Qualification artifacts are
versioned below `artifacts/studionet/` and are not canonical configuration.

## Qualification status

The first Vault deployment exposed a live constructor boundary defect:
`Address(Address(...))`. It is preserved as qualification-v1 provenance. The
V5/V6 histories remain preserved, and the V7 pair is the current
source-verified Studionet qualification deployment.

Read [`docs/QUALIFICATION.md`](docs/QUALIFICATION.md),
[`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md), and
[`docs/STEWARD_NOTES.md`](docs/STEWARD_NOTES.md) before any deployment.
