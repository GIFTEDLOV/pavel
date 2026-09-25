# Protocol

## Remediation: canonical fulfillment gate and challenge read model

`assess_fulfillment` now fails closed before objective checks, semantic
consensus, or fulfillment-result writes unless the exact sequence-one
`FULFILLMENT` definition has an authenticated capture in an immutable regular
Intent snapshot. The gate verifies identity, Intent/Mandate/policy binding,
authority, committed SHA-256, committed byte length, complete UTF-8 content,
and the 4096-byte fulfillment bound. Missing, staged-only, malformed, or
challenge evidence leaves the Intent `FULFILLMENT_PENDING` with no settlement
direction.

The application reads `get_challenge_count`, `get_challenge_id`,
`get_dispute`, `get_challenge_evidence`, `get_snapshot`, and
`get_settlement_instruction` at `LATEST_FINAL`. `SUBMITTED` is displayed as a
notice; only canonical `QUALIFYING` state is shown as `CHALLENGE_BLOCKED` with
an empty settlement direction. The corrected source is pending a new
qualification deployment; the deployed V7 boundary is unchanged.

## Mandates

A principal creates a DRAFT Mandate, configures bounded fields and sealed HTTPS authority constraints, then seals it. Sealing computes a domain-separated SHA-256 fingerprint over canonical JSON. A sealed Mandate is immutable; revocation changes only current validity and retains the original record and fingerprint.

Child Mandates inherit the principal and require the parent authorized agent. Deterministic bounds enforce narrower numeric caps, budgets, duration, validity, expiry, challenge protection, and source-authority membership. A bounded delegation vector is required for semantic scope inheritance before a child can seal.

## Intents

An authorized agent creates and submits an Intent against a registered counterparty identity. Counterparty identity, recipient, amount, deliverable, terms, expiry, and fingerprint are frozen at submission. `SUBMITTED` and `EVIDENCE_READY` are unassessed states; neither means consensus-cleared. `AUTHORIZATION_PENDING` and `AUTHORIZATION_RETRY_REQUIRED` are also not decisions. Legal Core states include DRAFT, SUBMITTED, evidence retry/recovery/repair states, EVIDENCE_READY, AUTHORIZATION_PENDING, AUTHORIZED, fulfillment states, DISPUTED, adjudicated outcomes, EXPIRED, and REJECTED. Vault-only economic states are not mirrored in Core.

## Evidence

Evidence definitions are append-only and bind kind, original HTTPS URL, authority, committed hash/length when available, sequence, Mandate/Intent identity, and policy fingerprint. Bounded remote capture occurs in a nondeterministic block. Deterministic code validates the bounded result and writes a write-once snapshot with digests, byte lengths, excerpts, original and transport URLs, capture time, ancestry, evidence-set identity, and a domain-separated fingerprint. Recovery changes availability, never identity.

## Authorization

Authorization asks whether the frozen Intent complies with the frozen Mandate. The deployed V7 lifecycle uses the `pavel-authorization-v2` schema with twelve JSON booleans; the schema name is historical V2 nomenclature, not a V6 deployment claim. Deterministic Core code derives `AUTHORIZED` only when every field is true; otherwise it stores `REJECTED`, `AUTHORIZATION_CHECKS_FAILED`, and the ordered `failed_checks` field names. No LLM-generated prose is required for canonical correctness. Deterministic code checks caller, expiry, amount, recipient, Mandate status, registered identity, source authority, and evidence readiness. Authorization is separate from payment reservation.

## Reservation

Vault synchronously reads Core authorization and validates every frozen economic value, budget, current epoch, available balance, and replay key. It moves available funds to reserved exactly once.

## Fulfillment and disputes

Core requires a matching Vault reservation before fulfillment review. Fulfillment evidence is appended to a later snapshot and must be fully authenticated within the explicit V7 bound of 4096 bytes; accepted fulfillment evidence is never passed to the semantic reviewer as an arbitrary prefix. Seven objective checks are derived from frozen Intent, Mandate, identity, reservation, evidence identity, hash, byte length, and authenticated capture state. Only `material_terms_satisfied` and `completion_evidence_sufficient` are sent to consensus as the exact three-key `pavel-fulfillment-v2` object. Core combines the objective checks and accepted semantic vector deterministically: all true produces `FULFILLED` with `RELEASE_TO_COUNTERPARTY`; any definitive false produces `NOT_FULFILLED` with `REFUND_TO_PRINCIPAL`.

If semantic evaluation is malformed or unresolved, Core records `FULFILLMENT_RETRY_REQUIRED` without a settlement direction. Once the frozen fulfillment deadline passes, any caller may invoke `expire_fulfillment`; Core records `FULFILLMENT_EXPIRED` and the refund direction. Vault can execute only the direction returned by Core, and its one-shot settlement guard prevents double release/refund. Thus an unresolved assessment cannot permanently trap the reservation merely because validator rotations were exhausted.

Any address may open a bounded challenge within the challenge window. The challenger must append properly formed challenge evidence and only its own evidence may be assessed. Challenge IDs are indexed per Intent, histories are append-only, and the oldest unresolved challenge has deterministic processing priority. Each challenge has its own fingerprint, evidence IDs, frozen independent snapshot, semantic result, status, and `resolved_at`. Every qualifying unresolved challenge blocks settlement; one challenge result cannot resolve another, and no owner can suppress a frozen third-party challenge.

## Settlement

Vault requests a release or refund only after reading Core's deterministic direction and challenge index. It moves reserved value to a pending bucket and emits a finalized external EOA message with a namespaced settlement ID. Pending means the external transfer has been requested; it is not a claim that the recipient has been observed credited.

Challenge intake is deliberately two-phase. `SUBMITTED` is an untrusted notice
and does not block settlement. Deterministic binding, deadline, uniqueness,
authority, permitted-kind, replay, and capacity checks plus successful required
evidence authentication are required before `QUALIFYING`. Infrastructure
failure enters a bounded retry/grace path; it is neither a rejection nor an
unbounded settlement veto. The 3600-second grace period ends intake and lets
any caller mark an unresolved stale challenge `EXPIRED`. There are at most 64
stored records and 16 simultaneously qualifying records per Intent; a
challenger may have at most one unresolved submitted or qualifying challenge.
This leaves a
documented bondless Sybil limitation, but malformed/unqualified notices cannot
consume security-critical qualifying capacity.
