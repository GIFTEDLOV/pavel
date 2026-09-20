# Threat model

| Threat | Boundary / mitigation |
| --- | --- |
| Malicious principal | Cannot mutate sealed policy; revocation preserves history. |
| Malicious agent | Intent caller, identity, recipient, amount, and policy are checked/frozen; Vault reads Core. |
| Malicious counterparty | Fulfillment and dispute evidence are authenticated, bounded, append-only. |
| Malicious web evidence | HTTPS/size/status/hash/length checks; content is data, not instructions. |
| Evidence liveness / transport failure | Original unavailable sources produce retry/recovery states. Alternate transport is authority-allowlisted and must reproduce exact committed bytes; identity fields are never rewritten. |
| Prompt injection | Explicit evidence delimiters and schema-only semantic outputs. |
| Unassessed mistaken for cleared | Core and frontend distinguish submitted, evidence-ready, authorization-pending, retry, rejected, and authorized; only explicit consensus outcomes use success semantics. |
| Evidence substitution/replay | Global IDs, Intent/Mandate binding, committed origin/hash/length, immutable evidence-set identity, and snapshot fingerprints. |
| Mutable/stale URLs | Later reviews use new sequenced snapshots; original snapshots are immutable. Recovery cannot change committed bytes, length, authority, or evidence ID. |
| Permissionless challenge suppression | Any address may open a bounded challenge; no owner deletion path exists; unresolved challenge indexes deterministically block settlement. |
| Permissionless challenge griefing / capacity capture | Submission is non-blocking; only authenticated, authority-bound `QUALIFYING` evidence blocks. Per-Intent records and qualifying entries are bounded, duplicate sets are rejected, and one challenger has one unresolved qualifying slot. A fixed deadline+grace expiry prevents infinite liveness delay. Residual bondless Sybil cost is explicit. |
| Challenge cross-resolution | Each challenge has independent evidence IDs, snapshot, vector, status, and resolution timestamp. Adjudication mutates only that challenge. |
| Repeated adverse notices | Challenge history is append-only, capped per Intent, chronologically indexed, and never overwritten by newer notices. |
| Authority identity mutation | Counterparty protocol identities bind wallet, approved HTTPS authority, and fingerprint before Intent creation. URLs are evidence transports, not identity authority. |
| Validator hallucination/disagreement | Independent structured validation; malformed/disagreement paths retry. |
| State-machine abuse | Explicit legal transitions and deterministic ownership/caller checks. |
| Economic replay | Reservation and settlement IDs are namespaced and one-shot. |
| Authority escalation | Child numeric/source-authority bounds and bounded delegation compatibility vector. |
| Cross-Mandate replay | Intent, evidence, reservation, and settlement identities bind Mandate IDs/fingerprints. |
| RPC ambiguity | Same transaction ID persistence and no automatic rebroadcast. |
| Frontend compromise | Browser is not authoritative; all economic values come from Core/Vault reads. |
| Wrong network | SDK chain/RPC guard rejects chain 61997, studio-dev, and studio-next. |
| Settlement uncertainty | Pending external states remain unconfirmed; no blind retry. |

## Qualification finding: decoded address boundaries

Stable Studionet constructor calldata can arrive at contract Python as a
GenLayer `Address` even when the caller supplied a hexadecimal address. A
normalization boundary that unconditionally evaluates `Address(value)` is
unsafe because `value` may already be an `Address`; the live Vault deployment
failed before initialization for exactly this reason. The mitigation is a
bounded `isinstance(value, Address)` branch in the Vault constructor and
address normalizer. The same latent boundary was found in Core's security-
critical address parameters and hardened with the same normalization rule;
this is recorded as a source change rather than hidden as a test-only fix.
The regression suite passes actual v0.2.16 runtime `Address` objects and
rejects zero addresses. No caller-supplied address is accepted as an identity
without the existing protocol ownership and authority checks.
