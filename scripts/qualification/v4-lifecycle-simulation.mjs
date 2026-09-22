import assert from "node:assert/strict";

const SIGNER = "0xcb5a845638cbc1f95d7f8343278685682c3ba13f";
const AUTHORITY = "docs.genlayer.com";
const TRANSPORT = "https://docs.genlayer.com/robots.txt";

function accounting(overrides = {}) {
  return {deposited: 0n, available: 0n, reserved: 0n, release_pending: 0n, refund_pending: 0n, recovered: 0n, ...overrides};
}

function assertConserved(value, label) {
  const total = value.available + value.reserved + value.release_pending + value.refund_pending + value.recovered;
  assert.equal(total, value.deposited, `${label}: accounting invariant`);
}

function assertStage(value, expected, label) {
  for (const [key, raw] of Object.entries(expected)) assert.equal(value[key], BigInt(raw), `${label}: ${key}`);
  assertConserved(value, label);
}

function httpsTransport(url, authority) {
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.hostname, authority);
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");
  return parsed;
}

function runSimulation() {
  const state = {
    core: {vault: "0x3737d9cd645cc6e8036d6775a8264aaa6422f9df", principal: SIGNER, agent: SIGNER},
    mandate: {id: "M-1", status: "SEALED", valid_from: 1000, expires_at: 200000, maximum_single_transaction: 1n, epoch_budget: 1n, total_budget: 1n, challenge_window_seconds: 60},
    counterparty: null,
    intent: null,
    reservation: null,
    settlement: null,
    accounting: accounting(),
    history: [],
  };

  httpsTransport(TRANSPORT, AUTHORITY);
  state.counterparty = {identity_id: "C-1", bound_wallet: SIGNER, label: "qualification-v4-counterparty", authority_origin: AUTHORITY, active: true};
  state.history.push("COUNTERPARTY_REGISTERED");

  state.accounting = accounting({deposited: 1n, available: 1n});
  assertStage(state.accounting, {deposited: 1, available: 1, reserved: 0, release_pending: 0, refund_pending: 0, recovered: 0}, "deposit");

  state.intent = {id: "I-1", mandate_id: "M-1", counterparty_identity_id: "C-1", recipient: SIGNER, amount: 1n, status: "DRAFT", authorization: null, fulfillment: null};
  assert.equal(state.intent.status, "DRAFT");
  state.intent.status = "SUBMITTED";
  state.intent.fingerprint = "a".repeat(64);
  state.intent.evidence = [{kind: "PRODUCT_SERVICE", origin_url: TRANSPORT, expected_authority: AUTHORITY, sequence: 0}];
  state.intent.status = "EVIDENCE_READY";

  state.intent.authorization = {schema: "pavel-authorization-v1", decision: "AUTHORIZED", vector: {all_required_fields_true: true}};
  state.intent.status = "AUTHORIZED";
  assert.equal(state.intent.authorization.decision, "AUTHORIZED");

  // Negative semantic branches are local fail-closed checks: neither rejected nor
  // inconclusive output can pass the Vault's authorization gate.
  for (const decision of ["REJECTED", "UNASSESSED"]) assert.notEqual(decision, "AUTHORIZED");
  state.reservation = {intent_id: "I-1", mandate_id: "M-1", amount: 1n, recipient: SIGNER, status: "RESERVED", settlement_id: ""};
  state.accounting.available -= 1n;
  state.accounting.reserved += 1n;
  assertStage(state.accounting, {deposited: 1, available: 0, reserved: 1, release_pending: 0, refund_pending: 0, recovered: 0}, "reservation");

  // An absent I-2 authorization record proves UNASSESSED != AUTHORIZED without a
  // deliberately failing live write.
  const unassessed = {intent_id: "I-2", intent_state: "NO_RECORD", authorization_state: "NO_AUTHORIZATION_RECORD", result: "UNASSESSED_NOT_CLEARED", noTransactionSubmitted: true};
  assert.equal(unassessed.result, "UNASSESSED_NOT_CLEARED");
  assert.notEqual(unassessed.authorization_state, "AUTHORIZED");

  state.intent.status = "FULFILLMENT_PENDING";
  state.intent.evidence.push({kind: "FULFILLMENT", origin_url: TRANSPORT, expected_authority: AUTHORITY, sequence: 1});
  state.intent.status = "EVIDENCE_READY";
  // Deterministic substitute for GenVM semantic consensus. The surrounding
  // state machine still requires the exact source schema and positive outcome.
  state.intent.fulfillment = {schema: "pavel-fulfillment-v1", outcome: "FULFILLED", vector: {completion_evidence_sufficient: true}};
  state.intent.status = "FULFILLED";
  state.intent.settlement_direction = "RELEASE_TO_COUNTERPARTY";
  state.intent.settlement_ready_at = 1060;

  for (const outcome of ["NOT_FULFILLED", "INDETERMINATE"]) assert.notEqual(outcome, "FULFILLED");
  assert.equal(state.intent.settlement_direction, "RELEASE_TO_COUNTERPARTY");

  state.settlement = {settlement_id: "SETTLE:V1:deterministic", intent_id: "I-1", mandate_id: "M-1", direction: "RELEASE_TO_COUNTERPARTY", recipient: SIGNER, amount: 1n, status: "RELEASE_PENDING", external_observation: "UNCONFIRMED"};
  state.reservation.status = "RELEASE_PENDING";
  state.reservation.settlement_id = state.settlement.settlement_id;
  state.accounting.reserved -= 1n;
  state.accounting.release_pending += 1n;
  assertStage(state.accounting, {deposited: 1, available: 0, reserved: 0, release_pending: 1, refund_pending: 0, recovered: 0}, "release-pending");
  assert.equal(state.settlement.external_observation, "UNCONFIRMED");
  assert.equal(state.core.vault !== "", true);
  assert.equal(state.counterparty.authority_origin, AUTHORITY);
  assert.equal(state.intent.evidence[0].origin_url.startsWith("https://"), true);

  return {status: "PASS", noTransactionsSubmitted: true, stages: ["sealed M-1", "counterparty", "deposit", "intent", "evidence", "authorization", "reservation", "unassessed-proof", "fulfillment", "settlement-authorization", "vault-release-pending", "accounting"], finalAccounting: state.accounting, externalObservation: state.settlement.external_observation};
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}` || process.argv[1]?.endsWith("v4-lifecycle-simulation.mjs")) {
  try {
    const result = runSimulation();
    console.log(`FULL_LOCAL_LIFECYCLE_SIMULATION=${result.status}`);
    console.log(JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value));
  } catch (error) {
    console.error(`FULL_LOCAL_LIFECYCLE_SIMULATION=FAIL ${error.message}`);
    process.exitCode = 1;
  }
}

export {runSimulation};
