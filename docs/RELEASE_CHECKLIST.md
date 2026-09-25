# PAVEL V8 release checklist

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
- [x] Network guard, deployment manifest validation, historical qualification validation, V8 qualification validation, source hash gate, and secret scan pass.
- [x] V8 Core and Vault finalize with successful execution.
- [x] Exact deployed-source parity is established for both contracts.
- [x] One-time binding is verified bidirectionally.
- [x] Controlled Mandate, evidence, authorization, reservation, fulfillment, challenge blocking/expiry, and settlement lifecycle passes.
- [x] External-message observation is reported honestly as `UNCONFIRMED`.
- [ ] V8 deployment, GitHub source, and production frontend are reconciled (push/CI/production release remains the final release action).

## Forbidden shortcuts

Do not call `ACCEPTED` success, rebroadcast an ambiguous transaction, use a
historical address, weaken source authority, or label `RELEASE_PENDING` paid.

## Steward remediation release boundary

The V8 pair is now deployed and qualified on stable Studionet. V7 remains
historical. The remaining checklist is repository push/CI merge and production
frontend reconciliation; no V7 address is reused.
