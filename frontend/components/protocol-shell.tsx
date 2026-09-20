import Link from "next/link";
import type { ReactNode } from "react";

const nav = [
  ["/app", "Overview"], ["/app/mandates", "Mandates"], ["/app/agents", "Agents"],
  ["/app/intents", "Intents"], ["/app/evidence", "Evidence"], ["/app/vault", "Vault"],
  ["/app/disputes", "Disputes"], ["/app/activity", "Activity"], ["/app/proof", "Proof"],
  ["/app/security", "Security"],
] as const;

export function ProtocolShell({ children }: { children: ReactNode }) {
  return <div className="shell"><aside><Link className="brand" href="/">PAVEL<span>Protocol</span></Link><p className="eyebrow">Policy-governed<br />Autonomous Value<br />Execution Layer</p><nav>{nav.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}</nav><div className="network-chip"><span className="dot" />Studionet · 61999</div></aside><main><header><div><span className="eyebrow">CONTROL PLANE</span><h1>Constitutional execution for autonomous agents.</h1></div><button className="wallet">Wallet disconnected</button></header>{children}</main></div>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return <section className="empty"><span className="empty-mark">—</span><h2>{title}</h2><p>{body}</p></section>;
}
