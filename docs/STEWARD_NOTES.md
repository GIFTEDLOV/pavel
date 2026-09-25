# Steward notes

PAVEL addresses the recurring review failures explicitly:

- Evidence availability is separate from identity. Recovery requires exact
  committed bytes, digest, length, authority, and policy binding.
- Principals and agents cannot suppress valid third-party challenge records.
- `SUBMITTED`, `EVIDENCE_READY`, and `AUTHORIZATION_PENDING` remain visibly and
  semantically distinct from `AUTHORIZED`.
- Counterparty identity is authority-bound; a caller-selected URL is only
  transport/evidence.
- Every challenge has independent evidence, snapshot, assessment, deadline,
  and resolution. A result cannot bulk-resolve other challenges.
- Repeated notices are append-only and indexed; settlement checks the complete
  qualifying set rather than only the first record.
- Capacity is split between bounded raw records and qualifying challenges, so
  malformed submissions cannot consume security-critical qualifying slots.
- Direct, adversarial, property, address-calldata, frontend status, and
  transaction persistence tests map these claims to code.

The V8 qualification above is the active corrected release. The V7 pair and
all V1-V7 failures remain historical provenance. V8 Core source hash is
`1636cc81461b5536103add686586308a05f599740a4e625e00825d8d11401e60`; V8 Vault
source hash is `f671005e07a658a17a7711807d23fa56bf0d6e2e85d0a266eafc17b03455f15c`.
Because Core/Vault binding is one-shot in both directions, V8 uses a fresh
pair. The live proof is tracked under
`deployments/studionet/qualification-v8/`.

The application now exposes the complete challenge command surface, canonical
challenge read model, settlement-block proof, recovery actions, fulfillment
sequence-one state, and canonical postcondition verification. The browser is
not treated as protocol authority.

## Release evidence

- `challenge-flow.json` proves `SUBMITTED` did not block settlement,
  authenticated evidence produced `QUALIFYING`, `CHALLENGE_BLOCKED` had an
  empty direction, and `EXPIRED` removed the blocker.
- `fulfillment-gate.json` proves sequence-one authentication preceded
  assessment; the deliberate live reverting assessment transaction was not
  sent, while Direct Mode and deployed-source parity prove the contract guard.
- `final-accounting.json` proves conservation and `reserved == 0` after the
  release request; external settlement remains `UNCONFIRMED`.
