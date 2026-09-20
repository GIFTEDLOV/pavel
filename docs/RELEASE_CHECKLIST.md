# Release checklist

This checklist separates local release readiness, qualification, and canonical
deployment. A qualification address is never silently promoted to production.

## Required gates

- [ ] Frozen commit and clean tracked worktree.
- [ ] Core and Vault source hashes recorded and reviewed.
- [ ] Python compile, Direct Mode, adversarial, property, and state-machine tests pass serially.
- [ ] GenVM lint, validation, schema, typecheck, and Core/Vault interface parity pass.
- [ ] Frontend tests, typecheck, lint, production build, and browser smoke pass.
- [ ] Network guard, manifest validation, source hash gate, and secret scan pass.
- [x] Qualification-v2 Core and Vault both finalize with successful execution.
- [x] Exact deployed-source parity is established for both contracts.
- [ ] One-time binding is verified bidirectionally.
- [ ] Controlled Mandate, evidence, authorization, reservation, fulfillment, challenge, and settlement lifecycle passes.
- [ ] External-message observation is reported honestly.
- [ ] Canonical deployment is separately authorized.

## Forbidden shortcuts

Do not call `ACCEPTED` success, rebroadcast an ambiguous transaction, use a
historical address, weaken source authority, or label `RELEASE_PENDING` paid.
