# PAVEL V7 qualification proof package

This sanitized package describes the already-proven PAVEL V7 deployment on
Studionet 61999. It contains public network, address, source-identity,
schema, and canonical-state facts only.

The package also contains a reproducible read-only canonical proof:

- `canonical-readback.json` records the public Core/Vault views observed from
  `https://studio.genlayer.com/api` using `LATEST_FINAL` only;
- `proof-index.json` records the proof structure, read count, and zero-write
  boundary; and
- `scripts/capture-v7-canonical-proof.mjs` can recapture the package without a
  wallet or a transaction submission.

The captured V7 identity is the canonical `M-1` / `I-1` lifecycle surfaced by
the paginated Core views. It records the qualified principal and agent,
bidirectional Core/Vault binding, authorization and fulfillment schemas,
reservation/accounting state, settlement direction, and Vault settlement
state. No lifecycle transaction hash is promoted without independently
substantiated committed evidence.

The package intentionally contains no lifecycle transaction hashes. The
candidate hashes from prior release notes were not independently substantiated
by tracked local qualification evidence in this repository, so they are
omitted rather than promoted into current proof. This omission does not alter
the deployed V7 contract identity or canonical qualification state.

External settlement remains `UNCONFIRMED`; `RELEASE_PENDING` is not reported as
paid.
