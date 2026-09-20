import Link from "next/link";
import type { ReactNode } from "react";
import { PAVEL_NETWORK } from "@/lib/pavel/network";
import { WalletStatus } from "@/components/wallet-status";

const nav = [
  ["/app", "Overview"], ["/app/mandates", "Mandates"], ["/app/agents", "Agents"],
  ["/app/intents", "Intents"], ["/app/evidence", "Evidence"], ["/app/vault", "Vault"],
  ["/app/disputes", "Disputes"], ["/app/activity", "Activity"], ["/app/proof", "Proof"],
  ["/app/security", "Security"], ["/integrate", "Integrate"],
] as const;

export function ProtocolShell({ children }: { children: ReactNode }) {
  return <div className="shell">
    <aside>
      <Link className="brand" href="/">PAVEL<span>Protocol</span></Link>
      <p className="eyebrow">Policy-governed<br />Autonomous Value<br />Execution Layer</p>
      <nav aria-label="Protocol sections">{nav.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}</nav>
      <div className="network-chip"><span className="dot" aria-hidden="true" />{PAVEL_NETWORK.alias} / chain {PAVEL_NETWORK.chainId}<small>Canonical read target</small></div>
    </aside>
    <main><header><div><span className="eyebrow">CONTROL PLANE / READ-ONLY UNTIL CONNECTED</span><h1>Constitutional execution for autonomous agents.</h1></div><WalletStatus /></header>{children}</main>
  </div>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return <section className="empty"><span className="empty-mark" aria-hidden="true">[—]</span><h2>{title}</h2><p>{body}</p></section>;
}
