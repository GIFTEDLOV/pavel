# Consensus

PAVEL uses `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` for custom structured semantic validation. It does not use `strict_eq` on raw LLM output.

The leader returns compact JSON with an exact schema. The validator checks the `gl.vm.Return` wrapper, exact keys, schema version, actual booleans, bounded explanation, and independent state-consequential fields. Missing keys, extra keys, wrong types, malformed JSON, free-form prose, and inconsistent outcomes are rejected. Explanations are retained for context but are not compared.

Authorization fields are purpose alignment, permitted activity, prohibited activity absence, counterparty scope, deliverable scope, commercial consistency, evidence sufficiency, duplicate absence, authority preservation, fulfillment terms, external dependency disclosure, and constitution satisfaction. Numeric caps, callers, recipients, addresses, amounts, Mandate status, expiry, source authority, and budget facts are deterministic.

Delegation has seven subset/protection booleans. Fulfillment has nine deliverable/material-term booleans plus a derived bounded outcome. Disputes have four support booleans plus a direction from a fixed enum. No semantic result can choose an economic amount or address.

The contract catches consensus/semantic exceptions and records retry states where possible. A retry state is not a semantic rejection, and `SUBMITTED`, `EVIDENCE_READY`, and `AUTHORIZATION_PENDING` are never presented as consensus-cleared. Challenge adjudication consumes only the target challenge's independent snapshot. A challenge result cannot bulk-resolve other open challenges; deterministic indexing and oldest-first priority remain in force.

Consensus is never inferred from submission or evidence presence. `SUBMITTED`,
`EVIDENCE_READY`, `AUTHORIZATION_PENDING`, `QUALIFYING`, and retry states are
not cleared states. Only the accepted structured result followed by its
deterministic state transition can produce `AUTHORIZED`, `REJECTED`,
`FULFILLED`, `NOT_FULFILLED`, or `RESOLVED`. Every challenge review has its own
leader/validator input and result; malformed output or disagreement changes
only that challenge to a retry state.
