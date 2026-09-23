"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { PAVEL_NETWORK } from "@/lib/pavel/network";
import { usePavel } from "./pavel-provider";
import { WalletStatus } from "./wallet-status";
import { TransactionCenter } from "./transaction-center";

type IconName = "home" | "mandates" | "intents" | "vault" | "activity" | "agents" | "evidence" | "disputes" | "proof" | "security" | "developers";

const nav: ReadonlyArray<readonly [string, string, IconName]> = [
  ["/app", "Home", "home"], ["/app/mandates", "Mandates", "mandates"], ["/app/intents", "Intents", "intents"], ["/app/vault", "Vault", "vault"], ["/app/activity", "Activity", "activity"],
];
const workspaceNav: ReadonlyArray<readonly [string, string, IconName]> = [["/app/agents", "Agents & counterparties", "agents"], ["/app/evidence", "Evidence", "evidence"], ["/app/disputes", "Disputes", "disputes"]];
const referenceNav: ReadonlyArray<readonly [string, string, IconName]> = [["/app/proof", "Proof", "proof"], ["/app/security", "Security", "security"], ["/integrate", "Developers", "developers"]];

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    home: <><path d="m3.5 10 6.5-6 6.5 6" /><path d="M5.5 8.5V16h9V8.5" /><path d="M8 16v-4h4v4" /></>,
    mandates: <><rect x="4" y="3.5" width="8" height="13" rx="1" /><path d="M7 6h2M7 9h2M7 12h2" /><path d="M12 6.5h3v9h-3" /></>,
    intents: <><circle cx="8" cy="8" r="4.5" /><path d="m11.5 11.5 4 4M6.5 8h3" /></>,
    vault: <><path d="M3 6.5h14v9H3z" /><path d="M3 6.5 5 4h12v2.5M12 11h2" /></>,
    activity: <><path d="M3 12h3l2-6 3.5 9 2-5H17" /></>,
    agents: <><circle cx="8" cy="7" r="2.5" /><path d="M3.5 16c.4-2.4 2-3.6 4.5-3.6s4.1 1.2 4.5 3.6" /><path d="M13 5.5h3M14.5 4v3" /></>,
    evidence: <><path d="M5 3.5h6l3 3V16H5z" /><path d="M11 3.5v3h3M7 10h5M7 13h4" /></>,
    disputes: <><path d="M4 4h12v8H9l-3 3v-3H4z" /><path d="M8 8h4" /></>,
    proof: <><path d="m10 3 2 2h2.5v2.5l2 2-2 2V14H12l-2 2-2-2H5.5v-2.5l-2-2 2-2V5H8z" /><path d="m7.5 9.5 1.5 1.5 3.5-3.5" /></>,
    security: <><path d="M10 3 16 5v4c0 4-2.5 6.5-6 8-3.5-1.5-6-4-6-8V5z" /><path d="m7.5 10 1.7 1.7 3.4-3.4" /></>,
    developers: <><path d="m7 5-5 5 5 5M13 5l5 5-5 5M11 3l-2 14" /></>,
  };
  return <svg className="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function activeFor(pathname: string, href: string) { return pathname === href || (href !== "/app" && pathname.startsWith(`${href}/`)); }
function pageTitle(pathname: string) { if (pathname === "/app") return "Home"; const segment = pathname.split("/").filter(Boolean).pop() ?? "app"; return segment.replaceAll("-", " ").replace(/^./, (value) => value.toUpperCase()); }

function NavItem({ href, label, icon, close }: { href: string; label: string; icon: IconName; close: () => void }) {
  const pathname = usePathname();
  return <Link className={activeFor(pathname, href) ? "nav-link nav-active" : "nav-link"} href={href} onClick={close}><Icon name={icon} /><span>{label}</span></Link>;
}

export function ProtocolShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { snapshotLoading, snapshotError, refreshSnapshot } = usePavel();
  const close = () => setMobileOpen(false);
  return <div className="app-shell">
    <aside className={mobileOpen ? "sidebar sidebar-open" : "sidebar"}>
      <div className="sidebar-top"><Link className="brand" href="/" onClick={close}><span className="brand-mark"><i /></span><span><strong>PAVEL</strong><small>Autonomous value control</small></span></Link><button className="mobile-close" type="button" onClick={close} aria-label="Close navigation">×</button></div>
      <div className="sidebar-section-label">Workspace</div>
      <nav aria-label="Primary navigation">{nav.map(([href, label, icon]) => <NavItem key={href} href={href} label={label} icon={icon} close={close} />)}</nav>
      <div className="sidebar-section-label sidebar-lower">More</div>
      <nav aria-label="Workspace tools">{workspaceNav.map(([href, label, icon]) => <NavItem key={href} href={href} label={label} icon={icon} close={close} />)}</nav>
      <div className="sidebar-lower sidebar-bottom"><nav aria-label="Reference navigation">{referenceNav.map(([href, label, icon]) => <NavItem key={href} href={href} label={label} icon={icon} close={close} />)}</nav></div>
      <div className="network-status"><span className="live-dot" aria-hidden="true" /><span>Studionet</span><small>Chain {PAVEL_NETWORK.chainId} · latest final</small></div>
    </aside>
    <div className="app-main"><header className="topbar"><button className="mobile-menu" type="button" onClick={() => setMobileOpen(true)} aria-label="Open navigation">☰</button><div className="topbar-context"><span className="topbar-page">{pageTitle(pathname)}</span><span className="read-state"><i className={snapshotError ? "read-dot read-dot-error" : "read-dot"} aria-hidden="true" />{snapshotLoading ? "Syncing" : snapshotError ? "Read unavailable" : "Latest final"}</span></div><div className="topbar-actions"><button className="icon-button" type="button" title="Refresh canonical state" onClick={() => void refreshSnapshot()} aria-label="Refresh canonical state">↻</button><span className="topbar-network"><i className="live-dot" aria-hidden="true" />Studionet</span><WalletStatus /></div></header><main className="app-content">{children}</main></div><TransactionCenter />
  </div>;
}
