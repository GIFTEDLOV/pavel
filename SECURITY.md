# Security posture

PAVEL V8 is source-verified on Studionet and has completed its hosted
qualification lifecycle. The external settlement observation remains
`UNCONFIRMED`; this repository does not claim external payment completion. The
current security boundary is:

- deterministic code owns identity, addresses, amounts, budgets, time checks, state transitions, replay keys, and settlement directions;
- nondeterministic blocks return bounded capture or semantic structures only;
- validators never choose recipients, principals, amounts, IDs, budgets, deadlines, or vault addresses;
- evidence is untrusted data and is delimited against prompt injection;
- Core does not mirror Vault accounting;
- external GEN transfers remain `RELEASE_PENDING` or `REFUND_PENDING` with `UNCONFIRMED` observation.
- `SUBMITTED`, `EVIDENCE_READY`, and `AUTHORIZATION_PENDING` remain explicitly unassessed; they are not rendered as consensus-cleared.
- registered counterparty identities bind wallet, approved authority origin, and fingerprint; URLs cannot redefine identity.
- recovery changes evidence availability only, and permissionless challenge indexes are append-only and settlement-blocking.
- Core rejects fulfillment assessment until canonical sequence-one fulfillment
  evidence is authenticated; this is a contract invariant, not only a UI gate.
- `SUBMITTED` challenges do not block settlement. Only authenticated
  `QUALIFYING` challenges block, and the V8 proof records both the blocker and
  its contract-enforced expiry.

Before changing the deployed contracts, run the complete qualification suite
against the exact source commit, extract and review schemas, update the
deployment manifest, and independently verify the one-time Core/Vault binding.
