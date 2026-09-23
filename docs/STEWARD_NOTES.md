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

The hosted V7 qualification is completed. The corrected Core/Vault pair is
deployed, source-verified, and bidirectionally bound. A wallet remains
required for new user-authorized writes, but it is not an outstanding
qualification dependency or a reason to describe the current release as
incomplete.
