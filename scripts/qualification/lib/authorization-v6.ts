export const AUTHORIZATION_V6_SCHEMA = "pavel-authorization-v2";

export const AUTHORIZATION_V6_FIELDS = [
  "purpose_aligned",
  "activity_permitted",
  "prohibited_activity_absent",
  "counterparty_scope_satisfied",
  "deliverable_in_scope",
  "commercial_terms_consistent",
  "evidence_semantically_sufficient",
  "duplicate_semantic_purchase_absent",
  "authority_scope_preserved",
  "fulfillment_terms_defined",
  "external_dependencies_disclosed",
  "constitution_satisfied",
] as const;

type AnyRecord = Record<string, any>;

function asRecord(value: unknown): AnyRecord {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
}

export function canonicalAuthorizedV6(item: unknown): boolean {
  const intent = asRecord(item);
  const authorization = asRecord(intent.authorization);
  const vector = asRecord(authorization.vector);
  if (intent.status !== "AUTHORIZED" || authorization.schema !== AUTHORIZATION_V6_SCHEMA || authorization.decision !== "AUTHORIZED") return false;
  if (authorization.reason_code !== "AUTHORIZED_ALL_CHECKS_PASSED") return false;
  if (!Array.isArray(authorization.failed_checks) || authorization.failed_checks.length !== 0) return false;
  if (Object.keys(vector).length !== AUTHORIZATION_V6_FIELDS.length) return false;
  return AUTHORIZATION_V6_FIELDS.every((field) => vector[field] === true);
}
