import Link from "next/link";
import type { ReactNode } from "react";
import { describeProtocolStatus } from "@/lib/pavel/status";
import type { ProtocolStatus } from "@/lib/pavel/types";

export function StatusBadge({ status }: { status: ProtocolStatus }) {
  const view = describeProtocolStatus(status);
  return <span className={`status status-${view.tone}`} aria-label={`Protocol state: ${view.label}`}>{view.label}</span>;
}

export function Section({ eyebrow, title, children }: { eyebrow?: string; title: string; children: ReactNode }) {
  return <section className="section">{eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}<h2>{title}</h2>{children}</section>;
}

export function DataCard({ label, value, note, href }: { label: string; value: string; note?: string; href?: string }) {
  const content = <><span className="label">{label}</span><strong className="data-value">{value}</strong>{note ? <span className="mono">{note}</span> : null}</>;
  return href ? <Link className="card card-link" href={href}>{content}</Link> : <div className="card">{content}</div>;
}

export function TrustBoundary({ title, body, tone = "neutral" }: { title: string; body: string; tone?: "neutral" | "warning" | "danger" }) {
  return <div className={`trust trust-${tone}`}><strong>{title}</strong><p>{body}</p></div>;
}

export function AddressValue({ value, label }: { value?: string; label: string }) {
  return <div className="address-line"><span className="label">{label}</span><code title={value ?? "Not configured"}>{value ?? "Not configured"}</code></div>;
}

export function NotConnected({ body = "Connect a wallet to read canonical Core and Vault state. PAVEL does not substitute fixture data for protocol state." }: { body?: string }) {
  return <div className="empty"><span className="empty-mark">[—]</span><h2>Wallet disconnected</h2><p>{body}</p><span className="status status-neutral">No canonical read performed</span></div>;
}

export function RouteIntro({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return <div className="route-intro"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{body}</p></div>;
}
