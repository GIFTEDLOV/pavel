# Security invariants

The following are machine-testable security invariants implemented or exercised
by the current V7 source:

32. `assess_fulfillment` cannot evaluate objective checks, invoke semantic
    consensus, or write an outcome until canonical sequence-one `FULFILLMENT`
    evidence is authenticated in an immutable regular Intent snapshot.
33. Sequence-one fulfillment authentication requires valid identity and
    Intent/Mandate/policy binding, permitted counterparty authority, committed
    SHA-256 and byte length equality, complete UTF-8 content, and a non-empty
    artifact no larger than 4096 bytes.
34. Missing, wrong-kind, wrong-sequence, staged-only, recovery-invalid,
    malformed, or challenge evidence fails closed and preserves
    `FULFILLMENT_PENDING` with no fulfillment result or settlement direction.
35. The application cannot infer authentication from a finalized transaction;
    it must read canonical capture and snapshot state at `LATEST_FINAL`.

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

23. `SUBMITTED` and infrastructure-failed challenges do not block settlement.
24. Only deterministically admissible, authenticated, non-expired
    `QUALIFYING` challenges consume qualifying capacity.
25. One unresolved submitted or qualifying challenge per challenger per Intent
    prevents a single address from cheaply filling the intake queue.
26. Stored challenge records, evidence sets, and review membership are bounded;
    valid records are append-only and cannot be deleted by the owner.
27. A stale challenge cannot delay settlement forever: deadline plus the fixed
    3600-second grace window ends retry intake and permits deterministic expiry.
28. A transport recovery changes availability only; it cannot change source
    authority, identity fingerprint, evidence set membership, or snapshot ID.
29. V7 fulfillment objective checks are computed from canonical state; they are
    not delegated back to the semantic reviewer.
30. A fulfillment artifact larger than 4096 bytes cannot be authenticated as an
    accepted fulfillment review input, so no accepted fulfillment decision is
    based on silent prefix truncation.
31. Every `FULFILLED`, `NOT_FULFILLED`, or `FULFILLMENT_EXPIRED` Intent has one
    Core settlement direction, and an unresolved pending/retry state has a
    deterministic deadline recovery path to `FULFILLMENT_EXPIRED`.
