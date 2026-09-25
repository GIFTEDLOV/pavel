"use client";

import { WriteButton, WriteForm } from "@/components/action-form";
import { ProtocolShell } from "@/components/protocol-shell";
import { EmptyState, Field, PageHeader, ReadState, Section, StatusBadge, TrustBoundary } from "@/components/protocol-ui";
import { usePavel } from "@/components/pavel-provider";
import { CORE_ADDRESS } from "@/lib/pavel/network";
import { normalizeChallengeStatus, normalizeIntentStatus } from "@/lib/pavel/status";
import type { ChallengeEvidenceRecord, ChallengeRecord, IntentRecord, SnapshotRecord } from "@/lib/pavel/types";

const chainInteger = (value: string) => BigInt(value || "0");
const EXPIRABLE_CHALLENGE_STATES = ["SUBMITTED", "EVIDENCE_PENDING", "EVIDENCE_RETRY_REQUIRED", "QUALIFYING", "ASSESSMENT_PENDING", "ASSESSMENT_RETRY_REQUIRED"];
const DEFINABLE_CHALLENGE_STATES = ["SUBMITTED", "EVIDENCE_PENDING"];

function evidenceSequence(evidence: ChallengeEvidenceRecord[]): number {
  return evidence.reduce((next, item) => Math.max(next, Number(item.sequence) + 1), 0);
}

function ChallengeEvidenceList({ evidence }: { evidence: ChallengeEvidenceRecord[] }) {
  if (!evidence.length) return <p className="helper">No challenge evidence has been defined.</p>;
  return <div className="evidence-read-list">{evidence.map((item) => <div className="evidence-read" key={item.evidence_id}><strong>{item.evidence_id} · {item.evidence_kind}</strong><code>{item.origin_url}</code><span className="mono">{item.expected_authority} · sequence {item.sequence} · {item.committed_sha256 || "Digest pending"} · {item.committed_byte_length || "0"} bytes</span></div>)}</div>;
}

function SnapshotProof({ snapshot }: { snapshot?: SnapshotRecord }) {
  if (!snapshot) return <p className="helper">No independent authenticated snapshot is present.</p>;
  return <div className="surface nested-surface"><div className="section-title-row"><strong>Independent snapshot {snapshot.snapshot_id}</strong><span className="mono">{snapshot.captures.length} authenticated capture(s)</span></div><div className="evidence-read-list">{snapshot.captures.map((capture) => <div className="evidence-read" key={capture.evidence_id}><strong>{capture.evidence_id} · {capture.capture_class}</strong><code>{capture.url}</code><span className="mono">transport {capture.transport_url} · {capture.sha256} · {capture.byte_length} bytes</span></div>)}</div><div className="key-value"><span>Evidence-set identity</span><code>{snapshot.evidence_set_identity}</code></div></div>;
}

function ChallengeCard({ challenge, evidence, independentSnapshot, intent, connectedAddress, refreshSnapshot }: { challenge: ChallengeRecord; evidence: ChallengeEvidenceRecord[]; independentSnapshot?: SnapshotRecord; intent: IntentRecord; connectedAddress?: string; refreshSnapshot: () => Promise<unknown> }) {
  const ownedByConnectedChallenger = Boolean(connectedAddress && connectedAddress.toLowerCase() === challenge.challenger.toLowerCase());
  const nextSequence = evidenceSequence(evidence);
  const defineAllowed = ownedByConnectedChallenger && DEFINABLE_CHALLENGE_STATES.includes(challenge.status);
  const stageAllowed = ["EVIDENCE_PENDING", "EVIDENCE_RETRY_REQUIRED"].includes(challenge.status) && evidence.length > 0;
  const recoveryAllowed = ownedByConnectedChallenger && ["EVIDENCE_RETRY_REQUIRED", "EVIDENCE_RECOVERY_REQUIRED", "EVIDENCE_REPAIR_REQUIRED"].includes(challenge.status) && evidence.length > 0;
  const adjudicateAllowed = ["QUALIFYING", "ASSESSMENT_RETRY_REQUIRED"].includes(challenge.status);
  const expireAllowed = EXPIRABLE_CHALLENGE_STATES.includes(challenge.status);
  const action = (method: string, args: readonly unknown[], targetState: string) => ({ actionKey: `core:${method}:${challenge.challenge_id}`, contract: CORE_ADDRESS, method, args, targetState });

  return <div className="surface challenge-card" data-challenge-id={challenge.challenge_id}>
    <div className="section-title-row"><div><span className="eyebrow">CHALLENGE {challenge.challenge_id}</span><h3>{challenge.reason}</h3></div><div><StatusBadge status={normalizeChallengeStatus(challenge.status)} /><span className="mono canonical-challenge-status">{challenge.status}</span></div></div>
    <div className="key-value"><span>Intent</span><code>{intent.intent_id}</code></div>
    <div className="key-value"><span>Challenger</span><code>{challenge.challenger}</code></div>
    <div className="key-value"><span>Protocol deadline</span><code>{challenge.deadline}</code></div>
    <div className="key-value"><span>Evidence-set identity</span><code>{challenge.evidence_set_identity || "NONE"}</code></div>
    <div className="key-value"><span>Independent snapshot</span><code>{challenge.independent_snapshot_id || "NONE"}</code></div>
    {challenge.last_error ? <p className="form-error">{challenge.last_error}</p> : null}
    <ChallengeEvidenceList evidence={evidence} />
    {defineAllowed ? <WriteForm submitLabel={`Define CHALLENGE evidence (sequence ${nextSequence})`} request={(values) => ({ actionKey: `core:define-challenge-evidence:${challenge.challenge_id}:${nextSequence}`, contract: CORE_ADDRESS, method: "define_challenge_evidence", args: [challenge.challenge_id, "CHALLENGE", values.url, values.authority, values.hash || "", chainInteger(values.byte_length), values.recovery_authority || values.authority, BigInt(nextSequence)], targetState: "Challenge evidence defined", beforeChallengeEvidenceCount: evidence.length })} onSubmitted={() => void refreshSnapshot()}>
      <Field label="Evidence URL"><input name="url" type="url" placeholder="https://…" required /></Field>
      <Field label="Authority host"><input name="authority" placeholder="challenge.example" required /></Field>
      <Field label="SHA-256"><input name="hash" placeholder="64 hex characters" required pattern="[0-9a-fA-F]{64}" /></Field>
      <Field label="Committed byte length"><input name="byte_length" inputMode="numeric" placeholder="128" required /></Field>
      <Field label="Recovery authority"><input name="recovery_authority" placeholder="same authority" /></Field>
      <p className="form-note">The next append-only sequence is derived from canonical challenge evidence: {nextSequence}.</p>
    </WriteForm> : null}
    {stageAllowed ? <div className="form-actions"><WriteButton request={action("stage_challenge_evidence", [challenge.challenge_id], "Challenge evidence staged") } label="Stage challenge evidence" onSubmitted={() => void refreshSnapshot()} /></div> : null}
    {recoveryAllowed ? <WriteForm submitLabel="Configure challenge evidence recovery" request={(values) => ({ actionKey: `core:configure-recovery:challenge:${challenge.challenge_id}:${evidence[0].evidence_id}`, contract: CORE_ADDRESS, method: "configure_evidence_recovery", args: [intent.intent_id, evidence[0].evidence_id, values.recovery_url], targetState: "Challenge evidence recovery configured" })} onSubmitted={() => void refreshSnapshot()}><Field label="Recovery URL"><input name="recovery_url" type="url" placeholder="https://..." required /></Field></WriteForm> : null}
    {challenge.status === "QUALIFYING" ? <><div className="trust trust-warning"><span className="trust-mark" aria-hidden="true">!</span><div><strong>QUALIFYING · settlement is blocked</strong><p>The independent snapshot is authenticated. Core has moved the Intent to DISPUTED and its settlement instruction must be CHALLENGE_BLOCKED with an empty direction.</p></div></div><SnapshotProof snapshot={independentSnapshot} /></> : null}
    {adjudicateAllowed ? <div className="form-actions"><WriteButton request={action("adjudicate_dispute", [challenge.challenge_id], "Challenge RESOLVED or assessment retry") } label="Adjudicate challenge" onSubmitted={() => void refreshSnapshot()} /></div> : null}
    {challenge.status === "RESOLVED" ? <><div className="key-value"><span>Resolution</span><strong>{challenge.resolution || "Recorded without direction"}</strong></div><div className="key-value"><span>Resolved at</span><code>{challenge.resolved_at || "RECORDED"}</code></div></> : null}
    {expireAllowed ? <div className="challenge-expiry"><p className="helper">Expiry is contract-authoritative: Core enforces the recorded deadline plus its review grace period ({challenge.deadline} + 3600 seconds). The browser does not synthesize expiration.</p><WriteButton request={action("expire_challenge", [challenge.challenge_id], "Challenge EXPIRED") } label="Expire challenge" onSubmitted={() => void refreshSnapshot()} /></div> : null}
  </div>;
}

export default function DisputesPage() {
  const { snapshot, snapshotLoading, snapshotError, refreshSnapshot, wallet } = usePavel();
  const challengeable = snapshot?.intents.filter((intent) => ["FULFILLED", "NOT_FULFILLED", "DISPUTED", "ADJUDICATED_RELEASE", "ADJUDICATED_REFUND"].includes(intent.status)) ?? [];

  return <ProtocolShell>
    <PageHeader eyebrow="DISPUTES / CHALLENGES" title="Make adverse evidence explicit." body="Challenges are append-only records with their own evidence, deadlines, qualification, and adjudication. Submission alone never silently rewrites settlement." />
    <ReadState loading={snapshotLoading} error={snapshotError} onRetry={() => void refreshSnapshot()}>
      <Section eyebrow="CANONICAL INTENTS" title="Challenge surface">
        {challengeable.length ? <div className="grid grid-2">{challengeable.map((intent) => {
          const challenges = snapshot?.challenges[intent.intent_id] ?? [];
          const settlement = snapshot?.settlements[intent.intent_id];
          const settlementBlocked = settlement?.status === "CHALLENGE_BLOCKED";
          return <div className="challenge-intent" key={intent.intent_id}>
            <div className="surface challenge-intent-header"><div className="section-title-row"><div><span className="eyebrow">INTENT {intent.intent_id}</span><h3>{intent.title || intent.deliverable}</h3></div><StatusBadge status={settlementBlocked ? "SETTLEMENT_BLOCKED" : normalizeIntentStatus(intent.status)} /></div><div className="settlement-proof"><span className="label">Canonical settlement instruction</span><strong>{settlement?.status || "UNAVAILABLE"}</strong><span className="mono">direction: {settlement?.direction || "empty"}</span>{settlementBlocked ? <p className="helper">FULFILLED / settlement available → challenge evidence authenticated → challenge QUALIFYING → Intent DISPUTED → CHALLENGE_BLOCKED. A submitted challenge alone does not block settlement.</p> : <p className="helper">{settlement?.direction ? `${intent.status} / settlement direction ${settlement.direction}` : "No settlement direction is exposed by the latest-final read."}</p>}</div><WriteForm submitLabel="Open challenge" request={(values) => ({ actionKey: `core:open-dispute:${intent.intent_id}:${values.reason}`, contract: CORE_ADDRESS, method: "open_dispute", args: [intent.intent_id, values.reason], targetState: "Challenge SUBMITTED" })} onSubmitted={() => void refreshSnapshot({ intentId: intent.intent_id })}><Field label="Reason"><textarea name="reason" placeholder="Explain the material challenge" required /></Field></WriteForm></div>
            <div className="challenge-list">{challenges.length ? challenges.map((challenge) => <ChallengeCard key={challenge.challenge_id} challenge={challenge} evidence={snapshot?.challengeEvidence[challenge.challenge_id] ?? []} independentSnapshot={snapshot?.challengeSnapshots[challenge.challenge_id]} intent={intent} connectedAddress={wallet.address} refreshSnapshot={() => refreshSnapshot({ intentId: intent.intent_id })} />) : <EmptyState title="No challenge records" body="Open a challenge above. The new canonical SUBMITTED record will appear here after latest-final readback." />}</div>
          </div>;
        })}</div> : <EmptyState title="No challengeable intents" body="Challenges become available only after a canonical fulfillment result or a resolved challenge state." />}
      </Section>
    </ReadState>
    <Section eyebrow="RECOVERY MODEL" title="Deadline-aware, not destructive"><div className="grid grid-3"><div className="metric-card"><span className="label">Submission</span><strong className="data-value">Append-only</strong><span className="mono">SUBMITTED does not block settlement</span></div><div className="metric-card"><span className="label">Qualification</span><strong className="data-value">Evidence-bound</strong><span className="mono">Only QUALIFYING blocks with CHALLENGE_BLOCKED</span></div><div className="metric-card"><span className="label">Adjudication</span><strong className="data-value">Direction only</strong><span className="mono">Core records release, refund, or retry</span></div></div></Section>
    <TrustBoundary title="Deadlines are protocol facts" body="The application exposes the canonical deadline and grace semantics. It may present an expiry action, but Core alone decides whether expire_challenge is eligible." />
  </ProtocolShell>;
}
