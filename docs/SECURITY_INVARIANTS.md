# Security invariants

The following are machine-testable targets implemented or exercised in Phase 1:

1. Sealed Mandate policy fields and definition fingerprint never change through public methods.
2. A child's transaction cap, epoch budget, total budget, expiry, valid-from, challenge window, and source authorities never exceed parent protection bounds.
3. A semantic vector cannot mutate Intent economic fields.
4. Evidence definitions append by sequence; an evidence ID cannot be reused.
5. A snapshot binds its Intent/Mandate fingerprints and cannot be rebound.
6. One Intent can create at most one reservation.
7. One reservation can request at most one settlement.
8. A reservation cannot both release and refund.
9. Vault conservation holds per Mandate and globally: `available + reserved + release_pending + refund_pending + recovered = deposited`.
10. Core never uses a locally maintained Vault balance as authoritative economic state.
11. Revocation blocks new reservations unless the sealed Mandate allows prior authorized reservations.
12. Settlement direction is an enum; semantic code cannot invent recipient or amount.
13. `SUBMITTED`, `EVIDENCE_READY`, and `AUTHORIZATION_PENDING` are not equivalent to `AUTHORIZED`.
14. Evidence transport cannot redefine evidence identity: recovery preserves evidence ID, kind, Mandate/Intent IDs, committed SHA-256, byte length, authority, policy fingerprint, and evidence-set identity.
15. A recovery hash or length mismatch never produces an authenticated snapshot.
16. Challenge N can only resolve challenge N; one result cannot bulk-resolve unrelated challenges.
17. Principal, agent, or counterparty code has no suppression path for a valid third-party challenge.
18. No settlement instruction is executable while any qualifying unresolved challenge remains in the per-Intent index.
19. Source identity is authority-bound; a caller-selected URL cannot redefine a registered counterparty.
20. Challenge evidence and snapshots are immutable after freeze.
21. Repeated notices are append-only and processed oldest qualifying unresolved first.
22. Recovery changes availability, never identity.

