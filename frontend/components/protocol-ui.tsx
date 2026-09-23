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
  return <div className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{body ? <p>{body}</p> : null}</div>{action ? <div className="page-header-action">{action}</div> : null}</div>;
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
