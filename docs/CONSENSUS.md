# Consensus

PAVEL uses `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` for custom structured semantic validation. It does not use `strict_eq` on raw LLM output.

The current V7 authorization leader returns compact JSON with the exact `pavel-authorization-v2` schema: one schema key and twelve JSON booleans. The schema name is retained for compatibility; it is not a claim that the deployed lifecycle is V6. The validator checks the `gl.vm.Return` wrapper, exact key set, schema version, actual boolean types, and independent state-consequential fields. Missing keys, extra keys, wrong types, malformed JSON, free-form prose, and inconsistent vectors are rejected. No free-form explanation participates in authorization consensus.

Authorization fields are purpose alignment, permitted activity, prohibited activity absence, counterparty scope, deliverable scope, commercial consistency, evidence sufficiency, duplicate absence, authority preservation, fulfillment terms, external dependency disclosure, and constitution satisfaction. Numeric caps, callers, recipients, addresses, amounts, Mandate status, expiry, source authority, and budget facts are deterministic. All twelve fields must be true for `AUTHORIZED`; otherwise deterministic Core code stores `REJECTED` and the ordered false-field list as `failed_checks` with a fixed reason code.

Delegation has seven subset/protection booleans. V7 fulfillment separates seven deterministic objective checks from the only two semantic checks that require independent model judgment: `material_terms_satisfied` and `completion_evidence_sufficient`. Its exact consensus payload is `pavel-fulfillment-v2` with three keys (`schema` plus those two booleans), with no explanation or metadata. Disputes have four support booleans plus a direction from a fixed enum. No semantic result can choose an economic amount or address.

V6 fulfillment behavior remains preserved as audit history; it is not the V7 design. V7 passes the complete authenticated fulfillment artifact only when it is at most 4096 bytes. Larger artifacts are rejected as malformed evidence rather than silently truncated. A validator disagreement is fail-closed and leaves the Intent retryable until its deterministic fulfillment deadline, after which Core can record `FULFILLMENT_EXPIRED` with a refund direction.

The contract catches consensus/semantic exceptions and records retry states where possible. A retry state is not a semantic rejection, and `SUBMITTED`, `EVIDENCE_READY`, and `AUTHORIZATION_PENDING` are never presented as consensus-cleared. Challenge adjudication consumes only the target challenge's independent snapshot. A challenge result cannot bulk-resolve other open challenges; deterministic indexing and oldest-first priority remain in force.

Consensus is never inferred from submission or evidence presence. `SUBMITTED`,
`EVIDENCE_READY`, `AUTHORIZATION_PENDING`, `QUALIFYING`, and retry states are
not cleared states. Only the accepted structured result followed by its
deterministic state transition can produce `AUTHORIZED`, `REJECTED`,
`FULFILLED`, `NOT_FULFILLED`, or `RESOLVED`. Every challenge review has its own
leader/validator input and result; malformed output or disagreement changes
only that challenge to a retry state.
