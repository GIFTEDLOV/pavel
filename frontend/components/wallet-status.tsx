"use client";

import { useState } from "react";
import { usePavel } from "./pavel-provider";
import { PAVEL_NETWORK } from "@/lib/pavel/network";

function shortAddress(address?: string): string {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Connect wallet";
}

export function WalletStatus() {
  const { wallet, connectWallet, switchToStudionet, disconnectWallet } = usePavel();
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  async function copyAddress() {
    if (!wallet.address) return;
    await navigator.clipboard?.writeText(wallet.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  if (wallet.status === "WRONG_NETWORK") {
    return <div className="wallet-control"><button className="button button-danger" type="button" onClick={() => void switchToStudionet()}>Switch to Studionet</button><span className="wallet-hint">Wallet is on chain {wallet.chainId ?? "unknown"}; PAVEL uses {PAVEL_NETWORK.chainId}.</span></div>;
  }
  if (wallet.status === "ERROR") {
    return <div className="wallet-control"><button className="button button-secondary" type="button" onClick={() => void connectWallet()}>Retry wallet</button><span className="wallet-hint">{wallet.error ?? "Wallet unavailable"}</span></div>;
  }
  if (wallet.status !== "CONNECTED" || !wallet.address) {
    return <button className="button button-primary wallet-connect" type="button" onClick={() => void connectWallet()} disabled={wallet.status === "CONNECTING"}>{wallet.status === "CONNECTING" ? "Opening wallet…" : "Connect wallet"}</button>;
  }
  return <div className="wallet-menu"><button className="wallet-account" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}><span className="identicon" aria-hidden="true">{wallet.address.slice(2, 4)}</span><span><strong>{shortAddress(wallet.address)}</strong><small>Studionet · {PAVEL_NETWORK.chainId}</small></span><span className="chevron" aria-hidden="true">⌄</span></button>{open ? <div className="wallet-popover"><button type="button" onClick={() => void copyAddress()}>{copied ? "Copied address" : "Copy address"}</button><button type="button" onClick={() => void switchToStudionet()}>Switch network</button><button type="button" onClick={disconnectWallet}>Disconnect</button></div> : null}</div>;
}
