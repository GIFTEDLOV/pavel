# Architecture

PAVEL separates constitutional authority from economic custody.

## Steward remediation boundary

The corrected local Core adds a contract-level precondition to fulfillment
assessment: canonical sequence-one authenticated evidence must be present and
complete before deterministic or semantic assessment begins. The frontend
mirrors this gate and exposes sequence-zero authorization evidence separately.

The application challenge surface is read-model driven. It enumerates indexed
challenge records and evidence, derives append-only evidence sequence from
canonical state, and verifies each write by a `LATEST_FINAL` postcondition.
Only a qualifying challenge blocks settlement. A submitted challenge is
visible but does not create a local settlement veto.

V7 binding is one-shot in both directions. Core source hash
`1636cc81461b5536103add686586308a05f599740a4e625e00825d8d11401e60` therefore
requires a fresh Core; the deployed V7 Vault remains bound to the historical
Core and is not reusable. The corrected pair is not deployed.

## PavelCore

Core owns principals, registered agents, authority-bound counterparty identities, Mandates, definition fingerprints, delegation ancestry, Intents, evidence definitions, staged capture results, immutable snapshots, semantic vectors, permissionless independently indexed challenges, challenge deadlines, revocation, and settlement directions. Core never stores a Vault balance as authoritative truth.

## PavelVault

Vault owns GEN deposits, available and reserved funds, pending outbound balances, recovery totals, per-Mandate budgets, epoch accounting, reservations, settlement IDs, and solvency/conservation reads. A payable deposit derives its principal from Core and `gl.message.sender_address`; the frontend cannot assign a deposit to somebody else.

## Cross-contract boundary

`@gl.contract_interface` is used for Core/Vault typed synchronous view calls. A Core-to-Vault write is never treated as atomic or synchronous. The flow is pull-verification:

1. Core records `AUTHORIZED` and frozen economic terms.
2. A permitted caller invokes `Vault.reserve(intent_id)`.
3. Vault reads Core and deterministically reserves exact frozen values.
4. Core reads Vault reservation state before fulfillment review.
5. Core records a release/refund direction after fulfillment or dispute.
6. A caller invokes Vault settlement; Vault reads Core, moves accounting once, and emits the finalized external transfer.

Internal write-message semantics therefore do not create a hidden callback or shadow ledger. The Vault binding is one-time: Vault is constructed with Core, its deployment binding admin calls `bind_core()`, and Core owner calls `set_vault_address()` once. Both addresses are readable and immutable after binding. Consequently a V6 Core cannot be attached to the deployed V5 Vault, and a fresh V6 Vault cannot inherit V5's stored deposit or Core records without an explicit migration interface; none exists in the deployed contracts.

## Frontend trust boundary

The browser is an untrusted transaction initiator and read client. It does not contain a server wallet, authoritative database, fabricated statistics, or automatic rebroadcast. It persists the transaction ID immediately after broadcast and reconciles the same ID through consensus status, finalization, execution result, and Core/Vault readback. Unassessed and evidence-ready states remain neutral in the UI.
