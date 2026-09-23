"use client";

import Link from "next/link";
import { ProtocolShell } from "@/components/protocol-shell";
import { DataCard, EmptyState, NotConnected, ReadState, StatusBadge } from "@/components/protocol-ui";
import { usePavel } from "@/components/pavel-provider";
import { normalizeIntentStatus } from "@/lib/pavel/status";
import { formatGen } from "@/lib/pavel/units";

function formatAccounting(value?: string | boolean) { return formatGen(typeof value === "string" ? value : "0"); }

function SetupJourney({ connected, mandateCount }: { connected: boolean; mandateCount: number }) {
  if (!connected || mandateCount > 0) return null;
  return <section className="setup-journey"><div><span className="eyebrow">WELCOME TO PAVEL</span><h2>Set up your first control boundary.</h2><p>Your wallet becomes the principal. We will guide you through the four steps needed before an agent can act.</p></div><div className="setup-steps"><span className="setup-step is-current"><i />Principal</span><span className="setup-step"><i />Agent</span><span className="setup-step"><i />Mandate</span><span className="setup-step"><i />Fund</span></div><Link className="button button-primary" href="/app/agents">Register principal <span aria-hidden="true">→</span></Link></section>;
}

export default function AppPage() {
  const { snapshot, snapshotLoading, snapshotError, refreshSnapshot, wallet } = usePavel();
  const accounting = snapshot?.globalAccounting;
  const mandates = snapshot?.mandates ?? [];
  const activeMandates = mandates.filter((mandate) => mandate.status === "SEALED");
  const intents = snapshot?.intents ?? [];
  const active = intents.filter((intent) => !["EXPIRED", "CANCELLED"].includes(intent.status));
  const attention = [
    ...mandates.filter((mandate) => mandate.status === "DRAFT").map((mandate) => ({ id: mandate.mandate_id, eyebrow: "MANDATE", title: `${mandate.mandate_id} needs configuration`, body: "Finish the policy before an agent can use it.", href: `/app/mandates/${mandate.mandate_id}`, action: "Continue" })),
    ...intents.filter((intent) => ["EVIDENCE_READY", "EVIDENCE_RETRY_REQUIRED", "AUTHORIZATION_PENDING", "FULFILLMENT_PENDING", "FULFILLMENT_RETRY_REQUIRED", "DISPUTED"].includes(intent.status)).map((intent) => ({ id: intent.intent_id, eyebrow: "INTENT", title: `${intent.intent_id} · ${intent.status === "FULFILLMENT_PENDING" ? "fulfillment evidence required" : intent.status === "AUTHORIZATION_PENDING" ? "authorization in progress" : "review required"}`, body: intent.title || intent.deliverable, href: `/app/intents/${intent.intent_id}`, action: "Review" })),
  ];
  const pendingActions = attention.length;
  return <ProtocolShell><ReadState loading={snapshotLoading} error={snapshotError} onRetry={() => void refreshSnapshot()}><section className="dashboard-hero"><div><span className="eyebrow">WORKSPACE / {wallet.status === "CONNECTED" ? "CONNECTED" : "READ ONLY"}</span><h1>{activeMandates.length ? `Your agents are operating inside ${activeMandates.length} active mandate${activeMandates.length === 1 ? "" : "s"}.` : "Give your first agent a clear boundary."}</h1><p>{activeMandates.length ? "Review what needs attention, then move the next intent forward." : "PAVEL keeps authority, evidence, and value legible from the first decision to settlement."}</p></div><Link className="button button-primary" href={activeMandates.length ? "/app/intents#new-intent" : "/app/agents"}>{activeMandates.length ? "+ New intent" : "Continue setup"}</Link></section><SetupJourney connected={wallet.status === "CONNECTED"} mandateCount={mandates.length} /><section className="dashboard-metrics"><DataCard label="Available" value={`${formatAccounting(accounting?.available)} GEN`} note="Latest final" href="/app/vault" tone="accent" /><DataCard label="Reserved" value={`${formatAccounting(accounting?.reserved)} GEN`} note="Canonical custody" href="/app/vault" /><DataCard label="Active mandates" value={String(activeMandates.length)} note={`${mandates.length} total on chain`} href="/app/mandates" /><DataCard label="Pending actions" value={String(pendingActions)} note={pendingActions ? "Needs your review" : "You are clear"} href="/app/intents" tone={pendingActions ? "warning" : undefined} /></section><section className="dashboard-grid"><div className="action-center"><div className="section-title-row"><div><span className="eyebrow">ACTION CENTER</span><h2>What needs your attention</h2></div><span className="mono">{pendingActions} open</span></div>{attention.length ? <div className="action-list">{attention.slice(0, 5).map((item) => <Link className="action-row" key={item.id} href={item.href}><span className="action-index" aria-hidden="true">↗</span><span><small>{item.eyebrow}</small><strong>{item.title}</strong><em>{item.body}</em></span><b>{item.action}</b></Link>)}</div> : <div className="clear-state"><span className="clear-mark">✓</span><strong>You&apos;re clear.</strong><p>No action is currently required.</p></div>}</div><div className="recent-panel"><div className="section-title-row"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Latest work</h2></div><Link className="text-link" href="/app/activity">View all</Link></div>{active.length ? <div className="recent-list">{active.slice(0, 5).map((intent) => <Link className="recent-row" key={intent.intent_id} href={`/app/intents/${intent.intent_id}`}><span className="activity-dot" /><span><strong>{intent.title || "Intent updated"}</strong><small>{intent.intent_id} · {intent.mandate_id}</small></span><StatusBadge status={normalizeIntentStatus(intent.status)} /></Link>)}</div> : <EmptyState title="No activity yet" body="Your live Intent and Mandate activity will appear here." action={<Link className="button button-secondary" href="/app/mandates">Create a mandate</Link>} />}</div></section><NotConnected body="Public state is available now. Connect a wallet when you want to create a Mandate, fund the Vault, or move an Intent forward." /></ReadState></ProtocolShell>;
}
