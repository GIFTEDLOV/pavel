"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { PAVEL_NETWORK } from "@/lib/pavel/network";
import { usePavel } from "./pavel-provider";
import { WalletStatus } from "./wallet-status";
import { TransactionCenter } from "./transaction-center";

const nav = [
  ["/app", "Overview", "⌂"], ["/app/mandates", "Mandates", "M"], ["/app/agents", "Agents", "A"],
  ["/app/intents", "Intents", "I"], ["/app/evidence", "Evidence", "E"], ["/app/vault", "Vault", "V"],
  ["/app/disputes", "Disputes", "D"], ["/app/activity", "Activity", "↗"],
] as const;

const secondaryNav = [["/app/proof", "Proof"], ["/app/security", "Security"], ["/integrate", "Developers"]] as const;

export function ProtocolShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { snapshotLoading, snapshotError, refreshSnapshot } = usePavel();
  return <div className="app-shell">
    <aside className={mobileOpen ? "sidebar sidebar-open" : "sidebar"}>
      <div className="sidebar-top"><Link className="brand" href="/" onClick={() => setMobileOpen(false)}><span className="brand-mark">P</span><span><strong>PAVEL</strong><small>Policy execution layer</small></span></Link><button className="mobile-close" type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation">×</button></div>
      <div className="sidebar-section-label">Control plane</div>
      <nav aria-label="Protocol sections">{nav.map(([href, label, icon]) => <Link className={pathname === href || pathname.startsWith(`${href}/`) ? "nav-link nav-active" : "nav-link"} key={href} href={href} onClick={() => setMobileOpen(false)}><span className="nav-icon" aria-hidden="true">{icon}</span>{label}</Link>)}</nav>
      <div className="sidebar-section-label sidebar-lower">Reference</div>
      <nav aria-label="Reference sections">{secondaryNav.map(([href, label]) => <Link className={pathname === href ? "nav-link nav-active" : "nav-link"} key={href} href={href} onClick={() => setMobileOpen(false)}>{label}</Link>)}</nav>
      <div className="network-status"><span className="live-dot" aria-hidden="true" /> <span>Studionet</span><small>Chain {PAVEL_NETWORK.chainId}</small></div>
    </aside>
    <div className="app-main"><header className="topbar"><button className="mobile-menu" type="button" onClick={() => setMobileOpen(true)} aria-label="Open navigation">☰</button><div className="topbar-context"><span className="topbar-kicker">PAVEL / CONTROL PLANE</span><span className="read-state">{snapshotLoading ? "Reading latest final…" : snapshotError ? "Read unavailable" : "Latest final"}<i className={snapshotError ? "read-dot read-dot-error" : "read-dot"} aria-hidden="true" /></span></div><div className="topbar-actions"><button className="icon-button" type="button" title="Refresh canonical state" onClick={() => void refreshSnapshot()} aria-label="Refresh canonical state">↻</button><WalletStatus /></div></header><main className="app-content">{children}</main></div><TransactionCenter />
  </div>;
}
