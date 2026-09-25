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

The hosted V7 qualification above is the historical/current deployed release.
This remediation is intentionally not deployed. The local corrected Core
source hash is `1636cc81461b5536103add686586308a05f599740a4e625e00825d8d11401e60`;
the deployed V7 Core remains `4acc04c4...b785a`. Because Core/Vault binding is
one-shot in both directions, the existing V7 Vault cannot be reused with the
corrected Core. The next release action is a fresh Core/Vault qualification and
only then a separately authorized push/deployment reconciliation.

The application now exposes the complete challenge command surface, canonical
challenge read model, settlement-block proof, recovery actions, fulfillment
sequence-one state, and canonical postcondition verification. The browser is
not treated as protocol authority.

## Required next deployment sequence

1. Build and hash the corrected Core source; deploy a fresh Core and record its
   finalized address and source hash.
2. Deploy a fresh Vault constructed with that Core address; call `bind_core()`
   from the binding admin and `set_vault_address()` from the new Core owner.
3. Read both one-shot bindings and source hashes at `LATEST_FINAL`; run the
   complete challenge, fulfillment-gate, custody, settlement, and qualification
   suites against the new pair.
4. Only after qualification succeeds, update the deployment manifest and
   current-facing addresses, then separately authorize the GitHub push and
   production frontend reconciliation.

The existing V7 pair is not mutated or migrated by these steps.
