"use client";

import { useState } from "react";
import { usePavel } from "./pavel-provider";
import { explorerTransactionUrl } from "@/lib/pavel/network";

export function TransactionCenter() {
  const { activeTransaction, dismissTransaction, trackTransaction } = usePavel();
  const [copied, setCopied] = useState(false);
  if (!activeTransaction) return null;
  const hash = activeTransaction.hash;
  async function copy() {
    if (!hash) return;
    await navigator.clipboard?.writeText(hash);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }
  const verified = activeTransaction.stage === "CANONICAL_VERIFIED";
  const finished = verified || activeTransaction.stage === "FINALIZED_SUCCESS";
  return <div className="tx-dock" role="status"><div className="tx-dock-top"><div><span className="eyebrow">TRANSACTION / SAME-ID RECONCILIATION</span><strong>{activeTransaction.method.replaceAll("_", " ")}</strong></div><button className="icon-button" type="button" onClick={dismissTransaction} aria-label="Close transaction panel">×</button></div><div className="tx-steps"><span className={activeTransaction.stage === "AWAITING_SIGNATURE" ? "tx-step active" : "tx-step done"}>Review</span><span className={activeTransaction.stage === "AWAITING_SIGNATURE" ? "tx-step active" : "tx-step done"}>Wallet</span><span className={hash ? "tx-step active" : "tx-step"}>Broadcast</span><span className={verified ? "tx-step done" : "tx-step"}>Readback</span></div>{hash ? <div className="tx-hash"><span>Transaction ID</span><code>{hash}</code><div className="inline-actions"><button className="button button-small button-secondary" type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy ID"}</button><a className="button button-small button-secondary" href={activeTransaction.explorerUrl ?? explorerTransactionUrl(hash)} target="_blank" rel="noreferrer">Explorer ↗</a></div></div> : null}<div className="tx-result"><span className={`status status-${activeTransaction.stage === "EXECUTION_FAILED" ? "danger" : finished ? "success" : "warning"}`}><span className="status-dot" aria-hidden="true" />{activeTransaction.stage.replaceAll("_", " ")}</span><span>{activeTransaction.error ?? (activeTransaction.stage === "AWAITING_SIGNATURE" ? "Approve once in your wallet. PAVEL will track this same transaction." : activeTransaction.targetState ?? "Waiting for canonical state")}</span></div>{hash && !finished && activeTransaction.stage !== "EXECUTION_FAILED" ? <button className="button button-primary button-full" type="button" onClick={() => void trackTransaction(hash)}>Track same transaction</button> : null}</div>;
}
