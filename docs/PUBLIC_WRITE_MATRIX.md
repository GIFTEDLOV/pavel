# PAVEL public write matrix

This is the current V8 public-write audit inventory. The V1–V7 records are
historical; the current V8 source exposes 24 Core
writes and 5 Vault writes. A caller is never trusted for economic values:
Core freezes them and Vault rereads them synchronously through typed views.
`N/A` in the nondeterministic column means the transition is deterministic.

## V8 contract-to-frontend parity

Every security-relevant action has a canonical read and a postcondition in the
provider transaction layer. Reads use `LATEST_FINAL`; the browser never treats
its own submitted transaction as protocol state.

| Contract method | Frontend action | Canonical readback | Postcondition |
| --- | --- | --- | --- |
| `define_challenge_evidence` | Define evidence form | `get_dispute`, `get_challenge_evidence` | Evidence count and record advance once |
| `stage_challenge_evidence` | Stage evidence | `get_dispute`, `get_intent`, `get_snapshot`, `get_settlement_instruction` | `QUALIFYING`, retry, or inadmissible canonical result |
| `adjudicate_dispute` | Adjudicate action | `get_dispute`, `get_intent`, `get_settlement_instruction` | `RESOLVED` or `ASSESSMENT_RETRY_REQUIRED` |
| `expire_challenge` | Expire action | `get_dispute`, `get_intent`, `get_settlement_instruction` | `EXPIRED` and blocker removed |
| `assess_fulfillment` | Assess fulfillment | `get_evidence(intent,1)`, `get_snapshot`, `get_intent`, `get_settlement_instruction` | Authenticated sequence one precedes any outcome |
| `expire_fulfillment` | Expire fulfillment | `get_intent`, `get_settlement_instruction` | Canonical expiry/refund direction |

The challenge read model also enumerates `get_challenge_count`,
`get_challenge_id`, `get_dispute`, `get_challenge_evidence`, `get_snapshot`,
and `get_settlement_instruction` for every relevant Intent. `configure_evidence_recovery`,
`start_fulfillment`, and `stage_evidence` are covered by the same provider
postcondition discipline.

## PavelCore

| Write | Authorized caller | Starting -> resulting state | Economic consequence | Nondeterministic / cross-contract | Replay / deadline / failure classes | Coverage |
|---|---|---|---|---|---|---|
| `register_principal()` | Any address, self-registration | absent -> registered | none | N/A / none | idempotent; registry cap; malformed sender | `test_public_write_surface::test_register_principal...` |
| `register_agent(agent,label)` | Registered principal that owns the binding | unbound -> bound | none | N/A / none | same binding is idempotent; conflicting binding, caller, length, cap | `test_public_write_surface::test_agent_and_counterparty_bindings...` |
| `register_counterparty(wallet,label,authority)` | Registered principal | unbound wallet -> active identity | none | N/A / none | wallet binding is one-shot; zero/address/HTTPS/authority/cap failures | `test_public_write_surface::test_agent_and_counterparty_bindings...`, `test_steward_hardening::test_source_authority...` |
| `set_vault_address(address)` | Core owner only | unbound -> bound | binds economic read authority; no funds moved | N/A / none | one-time replay rejection; zero/malformed/unauthorized failures | `test_public_write_surface::test_vault_binding...` |
| `create_mandate(agent,parent)` | Principal for root; parent agent for child | none -> `DRAFT` | none | N/A / none | monotonic ID; parent sealed/live/delegated checks; depth/cycle/bounds failures | `test_core_lifecycle`, `test_public_write_surface` |
| `configure_mandate(...)` | Mandate controller | `DRAFT` -> configured `DRAFT` | none | N/A / none | repeat allowed only before seal; immutable-after-seal, bounds, interval, authority failures | `test_core_lifecycle::test_mandate_seals_and_becomes_immutable` |
| `review_delegation(id)` | Parent authorized agent/controller as defined by Core | child `PENDING` -> `COMPATIBLE`/`INCOMPATIBLE` | none | structured delegation consensus / none | review may retry; exact child/parent fingerprint; expired/revoked/expanded bounds fail | `test_public_write_surface::test_delegation_review...`, schema matrix |
| `seal_mandate(id)` | Mandate controller | configured `DRAFT` -> `SEALED` | freezes future authority | N/A / none | one-shot; valid period, parent compatibility, fingerprint, authority failures | `test_core_lifecycle::test_mandate_seals...` |
| `revoke_mandate(id)` | Frozen principal | `SEALED` -> `REVOKED` | blocks new authority; prior reservations follow precommit | N/A / none | one-shot; principal/status failures; history retained | `test_lifecycle_sequences::test_intent_submission...`, state/property suite |
| `create_intent(...)` | Frozen authorized agent | none -> `DRAFT` | no funds | N/A / none | monotonic ID; mandate/identity/cap/expiry failures | `test_core_lifecycle::test_intent_freezes...` |
| `submit_intent(id)` | Frozen intent agent | `DRAFT` -> `SUBMITTED` | freezes intent fingerprint | N/A / none | one-shot; agent/mandate/expiry failures | `test_core_lifecycle`, lifecycle sequence tests |
| `define_evidence(...)` | Intent agent while evidence-accepting | append definition | none | N/A / none | `(Intent,evidence_id,sequence)` identity; duplicate/authority/URL/length failures | `test_steward_hardening`, evidence recovery audit |
| `define_challenge_evidence(...)` | Recorded challenger for its challenge | challenge `SUBMITTED` -> `EVIDENCE_PENDING` | none | N/A / none | `(challenge,evidence_id,sequence)` identity; deadline, authority, replay, kind failures | challenge admissibility and lifecycle tests |
| `configure_evidence_recovery(intent,evidence,url)` | Intent agent or recorded challenger for its own evidence | retry/repair -> recovery configured | none | N/A / none | recovery transport consumed once; authority/identity mismatch fails; deadline/grace applies | `test_evidence_recovery_audit`, steward recovery tests |
| `stage_evidence(intent)` | Permissionless trigger; evidence definitions are already bound | submitted/retry/recovery -> ready/retry/repair | none | web capture consensus / none | immutable snapshot ID; retryable infrastructure vs inadmissible evidence; snapshot cap | `test_core_lifecycle`, `test_web_failure_matrix`, recovery audit |
| `authorize_intent(intent)` | Permissionless trigger after deterministic preconditions | `EVIDENCE_READY` -> `AUTHORIZED`/`REJECTED`/retry | records authority only; no reservation | V7 bounded authorization consensus / none | exact `pavel-authorization-v2` object; malformed/disagreement -> retry, never rejection; all-true -> `AUTHORIZED`, any false -> deterministic rejection with `failed_checks` | `test_core_lifecycle`, LLM/schema/adversarial suites |
| `start_fulfillment(intent)` | Permissionless trigger after exact Vault reservation | `AUTHORIZED` -> `FULFILLMENT_PENDING` | no accounting mutation | synchronous Vault reservation view | one-shot state check; missing/mismatched reservation fails | public write surface, lifecycle sequences |
| `assess_fulfillment(intent)` | Permissionless trigger after authenticated sequence-one fulfillment evidence and reservation | pending -> `FULFILLED`/`NOT_FULFILLED`/retry | records fixed release/refund direction only | two-field semantic vector consensus / synchronous Vault view; seven objective checks are deterministic | missing, wrong, staged-only, malformed, or unauthenticated sequence one fails before objective checks and leaves pending; full authenticated content <=4096 bytes | V8 fulfillment gate suite, schema/adversarial suites |
| `expire_fulfillment(intent)` | Permissionless after the frozen fulfillment deadline | pending/retry -> `FULFILLMENT_EXPIRED` | records refund direction; no accounting mutation | N/A / synchronous Vault view | deadline required; idempotent state guard; only a matching reservation can transition | V8 fulfillment timeout suite |
| `expire_intent(intent)` | Permissionless | eligible unassessed state -> `EXPIRED` | no funds moved | N/A / none | deadline required; one-shot; never expires authorized/reserved state | `test_public_write_surface::test_expire_intent...` |
| `open_dispute(intent,reason)` | Any address during challenge window | challenge index append `SUBMITTED` | no funds; not blocking yet | N/A / none | duplicate submission, one unresolved submission per challenger, record cap, deadline, bounded reason; append-only | steward multi-challenge and lifecycle suites |
| `expire_challenge(id)` | Any address after deadline + 3600s grace | pending/qualifying -> `EXPIRED` | removes only that challenge's blocking count | N/A / none | one-shot; grace-bounded, indexed; no early expiry | challenge admissibility and lifecycle suites |
| `stage_challenge_evidence(id)` | Permissionless trigger for the frozen challenge | pending/retry -> `QUALIFYING`/`INADMISSIBLE`/retry | only qualifying status can block | web capture consensus / none | evidence-set replay, identity, authority, cap, grace; independent snapshot | challenge admissibility, evidence recovery, steward suites |
| `adjudicate_dispute(id)` | Permissionless trigger, oldest qualifying only | qualifying/retry -> `RESOLVED` or assessment retry | fixed release/refund direction; no amount choice | dispute vector consensus / none | target-only mutation, oldest-first, no duplicate resolution, challenge window/grace | steward multi-challenge, schema matrix |

## PavelVault

| Write | Authorized caller | Starting -> resulting state | Economic consequence | Nondeterministic / cross-contract | Replay / deadline / failure classes | Coverage |
|---|---|---|---|---|---|---|
| `bind_core()` | Deployment binding admin only | unbound -> bound | fixes Core authority | N/A / none | one-time; zero/malformed/unauthorized failure | `test_vault_lifecycle::test_vault_binding...` |
| `deposit(mandate_id)` payable | Principal recorded by Core | account absent/active -> deposited + available | native GEN enters Vault ledger | N/A / synchronous Core mandate view | positive value only; mandate/principal/status/conservation failures | `test_vault_lifecycle::test_vault_rejects_zero_deposit...`, public write surface |
| `reserve(intent_id)` | Frozen agent or principal from Core | no reservation -> `RESERVED` | available -> reserved; committed and epoch spend increase | N/A / synchronous Core authorization view | namespaced Intent replay; expiry, cap, budget, balance, binding failures | public write surface, Vault tests, property suite |
| `request_release(intent_id)` | Permissionless trigger after Core direction | `RESERVED` -> `RELEASE_PENDING` | reserved -> release pending; one external transfer request | N/A / synchronous Core settlement view + EVM recipient message | `SETTLE:V1` replay; challenge/deadline/reservation/direction failure; external observation remains unconfirmed | Vault settlement tests/property model; full two-IC route unavailable in Direct Mode |
| `request_refund(intent_id)` | Permissionless trigger after Core direction | `RESERVED` -> `REFUND_PENDING` | reserved -> refund pending; one external transfer request | N/A / synchronous Core settlement view + EVM recipient message | same one-shot namespace; release/refund exclusive; external failure is not blindly retried | Vault settlement tests/property model; full two-IC route unavailable in Direct Mode |

## Matrix audit conclusion

The write surface is 29 methods total. Every row has a positive path and a
negative state/authorization path in the named suites. Repeated-call coverage
is explicit for one-shot binding, sealing, submission, evidence recovery,
challenge submission/expiry/adjudication, reservation, and settlement. The
remaining permissionless trigger writes are safe to repeat only through their
state guards; a repeat is rejected or is a deterministic idempotent registry
operation. Direct Mode cannot execute a real Core/Vault pair in one harness,
so cross-contract positive paths use typed fake-view boundaries plus the
static `CORE_VAULT_INTERFACE_PARITY` gate.

## Steward contract-to-frontend parity audit

| Contract method / view | Frontend action or readback | Postcondition / test | Status |
|---|---|---|---|
| `define_challenge_evidence` | `/app/disputes` challenger form; canonical next sequence | Challenge evidence record advances; frontend reads `get_challenge_evidence` | PASS |
| `stage_challenge_evidence` | `/app/disputes` stage action | `QUALIFYING`, `EVIDENCE_RETRY_REQUIRED`, or `INADMISSIBLE`; refreshed `get_dispute` | PASS |
| `configure_evidence_recovery` | Challenge and fulfillment recovery forms | Canonical retry/recovery state after `LATEST_FINAL` refresh | PASS |
| `adjudicate_dispute` | `/app/disputes` only for qualifying/retry states | `RESOLVED` or `ASSESSMENT_RETRY_REQUIRED`; resolution read from `get_dispute` | PASS |
| `expire_challenge` | Deadline/grace-aware action; browser does not synthesize expiry | `EXPIRED`; challenge no longer appears as qualifying blocker | PASS |
| `get_dispute`, `get_challenge_count`, `get_challenge_id`, `get_challenge_evidence` | `readProtocolSnapshot` challenge index/read model | Typed challenge/evidence records, IDs, errors, statuses | PASS |
| `get_snapshot` | Independent challenge snapshot proof and fulfillment capture state | Snapshot identity, capture class, hash, length, and evidence-set identity | PASS |
| `get_settlement_instruction` | Disputes settlement proof and intent settlement card | `CHALLENGE_BLOCKED` is visible with empty direction only for qualifying blockers | PASS |
| `start_fulfillment` | Intent custody action | Intent becomes `FULFILLMENT_PENDING` | PASS |
| `stage_evidence` | Intent sequence-zero/sequence-one evidence actions | Authenticated or explicit retry/recovery/repair state | PASS |
| `assess_fulfillment` | Intent action only when canonical sequence-one evidence is authenticated | Contract gate runs before objective/semantic work; result or retry; premature state-mutation regression tests | PASS |
| `expire_fulfillment` | Contract-deadline action on intent page | `FULFILLMENT_EXPIRED` | PASS |

All security-relevant writes retain the discipline `BROADCAST ONCE` -> persist
hash -> reconcile the same hash -> finalized execution result -> latest-final
application readback. No production address or deployment manifest is changed
by this remediation.
