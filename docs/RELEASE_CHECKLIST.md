# PAVEL V7 release checklist

This checklist records the verified active release. Historical qualification
failures remain in the provenance record and are never silently promoted to
runtime configuration.

## Required gates

- [x] Frozen commit and clean tracked worktree.
- [x] Core and Vault source hashes recorded and reviewed.
- [x] Python compile, Direct Mode, adversarial, property, and state-machine tests pass serially.
- [x] Full reusable Node qualification suite passes (`111 passed`).
- [x] GenVM lint, validation, schema, typecheck, and Core/Vault interface parity pass.
- [x] Frontend tests, typecheck, lint, and production build pass.
- [x] Browser E2E — production Playwright audit passes at 1440px desktop, 430px mobile, and 390px mobile widths.
- [x] Network guard, deployment manifest validation, historical qualification-v2 validation, current V7 qualification validation, source hash gate, and secret scan pass.
- [x] V7 Core and Vault finalize with successful execution.
- [x] Exact deployed-source parity is established for both contracts.
- [x] One-time binding is verified bidirectionally.
- [x] Controlled Mandate, evidence, authorization, reservation, fulfillment, and settlement lifecycle passes.
- [x] External-message observation is reported honestly as `UNCONFIRMED`.
- [x] V7 deployment, GitHub source, and production frontend are reconciled.

## Forbidden shortcuts

Do not call `ACCEPTED` success, rebroadcast an ambiguous transaction, use a
historical address, weaken source authority, or label `RELEASE_PENDING` paid.

## Steward remediation release boundary

The checked-off list above describes the already deployed V7 release and is
not a claim that the corrected local source is deployed. For this remediation:

- [x] Core assessment is contract-gated on authenticated canonical sequence-one fulfillment evidence.
- [x] Challenge define, stage, adjudicate, expiry, recovery, reads, and settlement-block presentation are wired to canonical state.
- [x] Local frontend tests, typecheck, lint, and production build pass.
- [ ] Direct Mode / full contract qualification rerun on the corrected source.
- [ ] Fresh Core/Vault deployment and bidirectional binding.
- [ ] Fresh qualification, source-hash gate, GitHub push, and production reconciliation.

Do not update active V7 addresses until the fresh pair is qualified.
