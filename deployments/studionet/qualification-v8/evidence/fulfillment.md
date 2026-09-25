# Evidence model

The lifecycle is:

`DEFINITION -> NONDET REMOTE RETRIEVAL -> BOUNDED AUTHENTICATION RESULT -> DETERMINISTIC VALIDATION -> IMMUTABLE SNAPSHOT -> SEMANTIC REVIEW`

Committed evidence identity is separate from transport. A definition binds `evidence_id`, evidence kind, Mandate/Intent IDs, policy fingerprint, expected authority, committed SHA-256, and committed byte length. An unavailable original source produces `EVIDENCE_RETRY_REQUIRED`; an approved alternate transport produces `EVIDENCE_RECOVERY_REQUIRED`. Recovery is allowed only for a precommitted hash/length and an authority listed in the sealed Mandate. The original URL, identity, and evidence-set identity never change. Different bytes, length, authority, or evidence ID reject recovery.

URLs require HTTPS and reject whitespace, credentials, fragments, oversized authorities, and overlong values. GenVM exposes status and body but does not provide trusted redirect-origin attestation; PAVEL binds expected authority to the registered URL host and records that limitation. Responses are capped at 8192 bytes and excerpts at 2048 characters.

PAVEL distinguishes `AUTHENTICATED`, `MALFORMED_EVIDENCE`, and `INFRASTRUCTURE_FAILURE`. HTTP 408, 429, and 5xx are retryable infrastructure outcomes. 401/403/404/410, invalid UTF-8, empty content, oversized content, wrong origin preconditions, and hash/length mismatch are repairable or recovery failures. None is silently converted into a Mandate violation.

Snapshots are write-once, sequenced per Intent, and bind Mandate fingerprint, Intent fingerprint, evidence IDs/kinds/sequences, committed SHA-256, byte length, original URL, transport URL, capture time, parent snapshot, evidence-set identity, and policy version. Evidence IDs are global and never reused. Challenge evidence receives an independent snapshot and cannot redefine the original evidence set.

Counterparty identity is registered before Intent creation and binds a protocol identity ID to a wallet, approved HTTPS authority origin, and immutable fingerprint. A caller-selected URL is evidence about that identity, not the authority that creates it. Challenge evidence is bound to sealed authority constraints.

Evidence pages, invoices, descriptions, commercial terms, and challenge text are untrusted data. Prompts delimit them and explicitly rank the sealed Mandate and protocol schema above embedded instructions.

Recovery is a transport operation, not an identity operation. The committed
identity fingerprint includes the evidence ID, kind, Mandate ID, Intent ID,
challenge ID where applicable, expected authority, committed SHA-256,
committed byte length, policy fingerprint, and sequence. It intentionally does
not include the recovery transport URL. The recovery URL is consumed once;
the exact bytes, length, authority, and binding fields must still match. A
second candidate transport, a recovery after snapshot freeze, mutable-source
replacement, or a mirror with different bytes is rejected. An original source
can later recover without changing the original URL or snapshot identity.
