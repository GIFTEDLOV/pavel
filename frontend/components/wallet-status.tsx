"use client";

import { useState } from "react";
import { PAVEL_NETWORK } from "@/lib/pavel/network";

type Provider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
type WalletState = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "WRONG_NETWORK" | "ERROR";

declare global { interface Window { ethereum?: Provider } }

export function WalletStatus() {
  const [state, setState] = useState<WalletState>("DISCONNECTED");
  const [address, setAddress] = useState<string>();
  const [error, setError] = useState<string>();

  async function connect() {
    if (!window.ethereum) { setState("ERROR"); setError("No wallet provider detected"); return; }
    setState("CONNECTING"); setError(undefined);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const chain = await window.ethereum.request({ method: "eth_chainId" });
      const account = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : undefined;
      setAddress(account);
      if (String(chain).toLowerCase() !== "0xf22f") { setState("WRONG_NETWORK"); return; }
      setState(account ? "CONNECTED" : "ERROR");
      if (!account) setError("Wallet returned no account");
    } catch (cause) {
      setState("ERROR"); setError(cause instanceof Error ? cause.message : "Wallet request failed");
    }
  }

  const label = state === "CONNECTED" && address ? `${address.slice(0, 6)}...${address.slice(-4)}` : state === "WRONG_NETWORK" ? "Wrong network" : state === "CONNECTING" ? "Awaiting wallet" : state === "ERROR" ? "Wallet unavailable" : "Connect wallet";
  return <div className="wallet-wrap"><button className="wallet" type="button" onClick={connect} disabled={state === "CONNECTING"}>{label}</button>{state === "WRONG_NETWORK" ? <span className="wallet-error">Switch to {PAVEL_NETWORK.alias} / {PAVEL_NETWORK.chainId}</span> : error ? <span className="wallet-error">{error}</span> : null}</div>;
}
