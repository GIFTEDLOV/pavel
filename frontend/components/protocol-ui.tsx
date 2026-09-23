"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { describeProtocolStatus } from "@/lib/pavel/status";
import type { ProtocolStatus } from "@/lib/pavel/types";
import { usePavel } from "./pavel-provider";

export function StatusBadge({ status }: { status: ProtocolStatus }) {
  const view = describeProtocolStatus(status);
  return <span className={`status status-${view.tone}`} aria-label={`Protocol state: ${view.label}`}><span className="status-dot" aria-hidden="true" />{view.label}</span>;
}

export function Section({ id, eyebrow, title, action, children }: { id?: string; eyebrow?: string; title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="section" id={id}><div className="section-heading">{eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}<div className="section-title-row"><h2>{title}</h2>{action}</div></div>{children}</section>;
}

export function PageHeader({ eyebrow, title, body, action }: { eyebrow: string; title: string; body?: string; action?: ReactNode }) {
  const titles: Record<string, string> = { "A transaction is a trace, not a spinner.": "Your transaction trail.", "Authority with an identity attached.": "Who can act for you.", "Make adverse evidence explicit.": "Keep challenges visible.", "See what was captured, not just where it came from.": "Know what was captured.", "Proposal first. Value action second.": "Work waiting for a decision.", "Define the boundary an agent cannot widen.": "Set the boundary.", "A readable trail from source to state.": "Verify this deployment.", "Uncertainty is visible at every boundary.": "A clear boundary for every decision.", "Custody with a visible accounting trail.": "Your value, clearly accounted for." };
  const bodies: Record<string, string> = { "Every write is persisted as soon as the wallet returns a transaction ID. This feed reconciles that same ID through protocol finality, execution, and canonical state readback.": "Every write is kept here from wallet approval through finality and canonical state verification.", "Agents are registered wallets. They can submit intents inside a sealed Mandate; they never receive an independent withdrawal right.": "Register the wallets that may operate inside your sealed Mandates. Authority stays bounded by policy.", "Challenges are append-only records with their own evidence, deadlines, qualification, and adjudication. Submission alone never silently rewrites settlement.": "Open a challenge when fulfillment evidence needs review. Deadlines and settlement effects remain explicit.", "Every evidence definition commits an authority, URL, digest, byte length, policy fingerprint, and append-only sequence. The URL is transport; the identity is the committed snapshot.": "Review the source, digest, length, and authority behind each Intent before it moves forward.", "An Intent freezes the Mandate, counterparty, recipient, amount, deliverable, commercial terms, and fulfillment criteria before consensus touches it.": "Create a clear proposal, attach its evidence, and move it through authorization, fulfillment, and settlement.", "A Mandate is created, configured, and sealed as separate canonical writes. PAVEL never hides that lifecycle behind a single optimistic button.": "Mandates define exactly what an agent may do, how much it may spend, and which evidence it must provide.", "PAVEL exposes the network, addresses, schemas, and accounting boundary that the application is actually using. Historical versions are never runtime fallbacks.": "The active network, contracts, source hashes, and qualified protocol schemas used by PAVEL.", "PAVEL separates deterministic policy and custody facts from bounded semantic review. The UI follows those same trust boundaries.": "Policy, evidence, validator judgment, and custody each have a defined role. No layer silently takes another layer's authority.", "Vault balances come from canonical latest-final reads. Core chooses the settlement direction; Vault executes only that direction.": "See what is available, reserved, and waiting for settlement. Add funds when an authorized Intent needs them." };
  return <div className="page-header"><div><span className="eyebrow">{eyebrow.split(" /")[0]}</span><h1>{titles[title] ?? title}</h1>{body ? <p>{bodies[body] ?? body}</p> : null}</div>{action ? <div className="page-header-action">{action}</div> : null}</div>;
}

export function DataCard({ label, value, note, href, tone }: { label: string; value: string; note?: string; href?: string; tone?: "accent" | "warning" | "danger" }) {
  const content = <><span className="label">{label}</span><strong className={tone ? `data-value data-${tone}` : "data-value"}>{value}</strong>{note ? <span className="mono">{note}</span> : null}</>;
  return href ? <Link className="metric-card metric-link" href={href}>{content}<span className="card-arrow" aria-hidden="true">↗</span></Link> : <div className="metric-card">{content}</div>;
}

export function TrustBoundary({ title, body, tone = "neutral" }: { title: string; body: string; tone?: "neutral" | "warning" | "danger" }) {
  return <div className={`trust trust-${tone}`}><span className="trust-mark" aria-hidden="true">{tone === "danger" ? "!" : "i"}</span><div><strong>{title}</strong><p>{body}</p></div></div>;
}

export function AddressValue({ value, label }: { value?: string; label: string }) {
  return <div className="key-value"><span>{label}</span><code title={value ?? "Not configured"}>{value ?? "Not configured"}</code></div>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-mark" aria-hidden="true">∅</span><h3>{title}</h3><p>{body}</p>{action}</div>;
}

export function ReadState({ loading, error, onRetry, children }: { loading: boolean; error?: string; onRetry: () => void; children: ReactNode }) {
  if (loading) return <div className="read-panel read-loading"><span className="skeleton skeleton-wide" /><span className="skeleton skeleton-medium" /><span className="skeleton skeleton-short" /></div>;
  if (error) return <div className="read-panel read-error"><strong>Canonical read unavailable</strong><p>{error}</p><button className="button button-secondary" type="button" onClick={onRetry}>Retry read</button></div>;
  return <>{children}</>;
}

export function RouteIntro({ eyebrow, title, body, action }: { eyebrow: string; title: string; body: string; action?: ReactNode }) {
  return <PageHeader eyebrow={eyebrow} title={title} body={body} action={action} />;
}

export function AdvancedDetails({ children }: { children: ReactNode }) {
  return <details className="advanced"><summary>Advanced details</summary><div className="advanced-body">{children}</div></details>;
}

export function NotConnected({ body = "Connect a wallet when you want to write. Public protocol reads remain available without a signer." }: { body?: string }) {
  const { wallet, connectWallet } = usePavel();
  if (wallet.status === "CONNECTED") return null;
  return <div className="connect-panel"><div><span className="eyebrow">WRITE ACCESS</span><h3>Ready when you are</h3><p>{body}</p></div><button className="button button-primary" type="button" onClick={() => void connectWallet()}>Connect wallet</button></div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}
