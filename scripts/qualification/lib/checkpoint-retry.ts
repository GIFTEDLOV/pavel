export const AUTHORIZATION_STEP = "core:authorize_intent";

export const EARLIER_LIFECYCLE_STEPS = [
  "deploy:core",
  "deploy:vault",
  "vault:bind_core",
  "core:set_vault_address",
  "core:register_principal",
  "core:register_agent",
  "core:create_mandate",
  "core:configure_mandate",
  "core:seal_mandate",
  "core:register_counterparty",
  "vault:deposit",
  "core:create_intent",
  "core:submit_intent",
  "core:define_evidence:authorization",
  "core:stage_evidence:authorization",
] as const;

export type AuthorizationAttempt = {
  attempt: number;
  tx: string;
  status: string;
  execution: string;
  consensus: string;
  execution_success: boolean;
  canonical_commit: boolean;
  retry_permitted: boolean;
};

type AnyRecord = Record<string, any>;

function text(value: unknown) {
  return typeof value === "string" ? value : String(value ?? "");
}

function txOf(step: AnyRecord) {
  return text(step?.tx_hash ?? step?.tx);
}

function statusOf(step: AnyRecord) {
  return text(step?.terminal_status ?? step?.lifecycle?.statusName ?? step?.status);
}

function executionOf(step: AnyRecord) {
  return text(step?.execution ?? step?.lifecycle?.txExecutionResultName);
}

function canonicalOf(step: AnyRecord) {
  return step?.canonical_postcondition_met === true;
}

function attemptFromStep(step: AnyRecord, fallbackAttempt: number): AuthorizationAttempt | null {
  const tx = txOf(step);
  if (tx === "") return null;
  const execution = executionOf(step);
  return {
    attempt: Number(step?.attempt_number ?? fallbackAttempt),
    tx,
    status: statusOf(step) || "UNKNOWN",
    execution: execution || "UNKNOWN",
    consensus: text(step?.consensus_result) || "UNAVAILABLE",
    execution_success: step?.execution_success ?? execution === "FINISHED_WITH_RETURN",
    canonical_commit: canonicalOf(step),
    retry_permitted: step?.retry_permitted ?? !canonicalOf(step),
  };
}

export function authorizationAttempts(state: AnyRecord): AuthorizationAttempt[] {
  const persisted = state?.authorization?.attempts;
  if (Array.isArray(persisted) && persisted.length > 0) return persisted.map((item: AnyRecord, index: number) => ({
    attempt: Number(item.attempt ?? index + 1),
    tx: text(item.tx ?? item.tx_hash),
    status: text(item.status) || "UNKNOWN",
    execution: text(item.execution) || "UNKNOWN",
    consensus: text(item.consensus) || "UNAVAILABLE",
    execution_success: item.execution_success === true,
    canonical_commit: item.canonical_commit === true,
    retry_permitted: item.retry_permitted === true,
  }));

  const step = state?.steps?.[AUTHORIZATION_STEP];
  const history = step?.attempt_history;
  if (Array.isArray(history) && history.length > 0) return history.map((item: AnyRecord, index: number) => ({
    attempt: Number(item.attempt ?? index + 1),
    tx: text(item.tx ?? item.tx_hash),
    status: text(item.status) || "UNKNOWN",
    execution: text(item.execution) || "UNKNOWN",
    consensus: text(item.consensus) || "UNAVAILABLE",
    execution_success: item.execution_success === true,
    canonical_commit: item.canonical_commit === true,
    retry_permitted: item.retry_permitted === true,
  }));

  const legacy = step ? attemptFromStep(step, 1) : null;
  return legacy ? [legacy] : [];
}

/**
 * Migrates the old single-step representation in memory without treating a
 * stored hash as proof that the step completed. Callers persist the returned
 * state only at an explicit checkpoint boundary.
 */
export function ensureAuthorizationCheckpoint(state: AnyRecord): AnyRecord {
  state.authorization ??= {};
  const attempts = authorizationAttempts(state);
  if (attempts.length === 0) {
    state.authorization.attempts ??= [];
    return state;
  }
  state.authorization.attempts = attempts;
  const latest = attempts[attempts.length - 1];
  const step = state.steps?.[AUTHORIZATION_STEP] ?? {label: AUTHORIZATION_STEP};
  state.steps ??= {};
  state.steps[AUTHORIZATION_STEP] = {
    ...step,
    tx: latest.tx,
    tx_hash: latest.tx,
    terminal_status: step.terminal_status ?? latest.status,
    execution_success: step.execution_success ?? latest.execution_success,
    consensus_result: step.consensus_result ?? latest.consensus,
    canonical_postcondition_met: step.canonical_postcondition_met ?? latest.canonical_commit,
    retry_permitted: step.retry_permitted ?? latest.retry_permitted,
    attempt_number: latest.attempt,
    attempt_history: attempts,
  };
  state.authorizationResubmissions = Math.max(0, attempts.length - 1);
  return state;
}

export function appendAuthorizationAttempt(state: AnyRecord, attempt: AuthorizationAttempt) {
  ensureAuthorizationCheckpoint(state);
  state.authorization ??= {};
  state.authorization.attempts ??= [];
  state.authorization.attempts.push({...attempt});
  state.authorizationResubmissions = Math.max(0, state.authorization.attempts.length - 1);
  state.steps ??= {};
  const prior = state.steps[AUTHORIZATION_STEP] ?? {label: AUTHORIZATION_STEP};
  state.steps[AUTHORIZATION_STEP] = {
    ...prior,
    tx: attempt.tx,
    tx_hash: attempt.tx,
    terminal_status: attempt.status,
    execution_success: attempt.execution_success,
    consensus_result: attempt.consensus,
    canonical_postcondition_met: attempt.canonical_commit,
    retry_permitted: attempt.retry_permitted,
    attempt_number: attempt.attempt,
    attempt_history: state.authorization.attempts,
  };
}

export function updateLatestAuthorizationAttempt(state: AnyRecord, attempt: AuthorizationAttempt) {
  ensureAuthorizationCheckpoint(state);
  state.authorization ??= {};
  state.authorization.attempts ??= [];
  if (state.authorization.attempts.length === 0) {
    state.authorization.attempts.push({...attempt});
  } else {
    state.authorization.attempts[state.authorization.attempts.length - 1] = {...attempt};
  }
  state.authorizationResubmissions = Math.max(0, state.authorization.attempts.length - 1);
  state.steps ??= {};
  const prior = state.steps[AUTHORIZATION_STEP] ?? {label: AUTHORIZATION_STEP};
  state.steps[AUTHORIZATION_STEP] = {
    ...prior,
    tx: attempt.tx,
    tx_hash: attempt.tx,
    terminal_status: attempt.status,
    execution_success: attempt.execution_success,
    consensus_result: attempt.consensus,
    canonical_postcondition_met: attempt.canonical_commit,
    retry_permitted: attempt.retry_permitted,
    attempt_number: attempt.attempt,
    attempt_history: state.authorization.attempts,
  };
}

export function nextAuthorizationAttemptNumber(state: AnyRecord) {
  const attempts = authorizationAttempts(state);
  return attempts.length === 0 ? 1 : Math.max(...attempts.map((item) => item.attempt)) + 1;
}

export function authorizationRetryDecision(step: AnyRecord, explicitRetry: boolean, retryAlreadyUsed = false) {
  if (!step?.tx_hash && !step?.tx) return explicitRetry ? "INVALID_RETRY_TARGET" : "NEW_STEP";
  if (step.canonical_postcondition_met === true) return "NO_RESUBMIT_CANONICAL";
  const terminal = ["ACCEPTED", "FINALIZED", "REJECTED", "UNDETERMINED", "FAILED", "CANCELLED"].includes(statusOf(step).toUpperCase());
  if (!terminal) return "RECONCILE_SAME_TX";
  if (!explicitRetry) return "STOP_EXPLICIT_RETRY_REQUIRED";
  if (retryAlreadyUsed) return "NO_THIRD_ATTEMPT";
  return "SUBMIT_ONE_NEW_ATTEMPT";
}

export function parseRetryStep(argv: string[]) {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--retry-step") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("--retry-step requires an exact step label");
      values.push(next);
      index += 1;
    } else if (value.startsWith("--retry-step=")) {
      values.push(value.slice("--retry-step=".length));
    }
  }
  if (values.length > 1) throw new Error("Only one --retry-step may be supplied");
  if (values.length === 0) return "";
  if (values[0] !== AUTHORIZATION_STEP) throw new Error(`Explicit retry is not permitted for ${values[0]}`);
  return values[0];
}

export function assertRetryPlan(state: AnyRecord, retryStep: string) {
  if (retryStep === "") return;
  if (retryStep !== AUTHORIZATION_STEP) throw new Error(`Explicit retry is not permitted for ${retryStep}`);
  const target = ensureAuthorizationCheckpoint(state).steps?.[AUTHORIZATION_STEP];
  if (!target?.tx_hash && !target?.tx) throw new Error("Authorization retry requires a persisted prior transaction hash");
  if (target.canonical_postcondition_met === true) throw new Error("Authorization retry is not permitted after canonical postcondition success");
  if (authorizationAttempts(state).length >= 2) throw new Error("Only one controlled authorization retry is permitted; inspect attempt history before any further write");
  const incomplete = EARLIER_LIFECYCLE_STEPS.filter((label) => state.steps?.[label]?.status !== "COMPLETE");
  if (incomplete.length > 0) throw new Error(`Authorization retry would replay earlier lifecycle writes: ${incomplete.join(", ")}`);
  return {
    firstLiveWrite: AUTHORIZATION_STEP,
    noEarlierPhaseReplay: true,
    attemptNumber: nextAuthorizationAttemptNumber(state),
  };
}
