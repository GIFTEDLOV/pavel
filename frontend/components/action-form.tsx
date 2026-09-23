"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { PAVEL_NETWORK } from "@/lib/pavel/network";
import { formatGen } from "@/lib/pavel/units";
import { usePavel, type WriteRequest } from "./pavel-provider";

function ReviewDialog({ request, busy, onCancel, onConfirm }: { request: WriteRequest; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const applicationValue = request.value ?? 0n;
  return <div className="review-overlay" role="dialog" aria-modal="true" aria-label="Review transaction"><div className="review-dialog"><div className="review-top"><div><span className="eyebrow">REVIEW BEFORE SIGNING</span><h3>{request.method.replaceAll("_", " ")}</h3></div><button className="icon-button" type="button" onClick={onCancel} aria-label="Cancel transaction review">×</button></div><div className="review-details"><div><span>Network</span><strong>Studionet · {PAVEL_NETWORK.chainId}</strong></div><div><span>Contract</span><code>{request.contract}</code></div><div><span>Application value</span><strong>{formatGen(applicationValue)} GEN</strong><small>Exact raw units: {applicationValue.toString()}</small></div><div><span>Protocol fee</span><strong>Wallet-estimated separately</strong><small>genlayer-js 1.1.8 delegates gas estimation and fee selection to the stable client and wallet.</small></div><div><span>Total wallet requirement</span><strong>{formatGen(applicationValue)} GEN + protocol fee</strong></div><div><span>Target state</span><strong>{request.targetState ?? "Canonical state update"}</strong></div></div><p className="helper">PAVEL will broadcast exactly once, persist the returned transaction ID, track that same ID, and refresh latest-final state before showing a canonical result.</p><div className="form-actions"><button className="button button-secondary" type="button" onClick={onCancel}>Cancel</button><button className="button button-primary" type="button" onClick={onConfirm} disabled={busy}>{busy ? "Opening wallet…" : "Approve in wallet"}</button></div></div></div>;
}

export function WriteForm({ request, children, submitLabel = "Review and sign", onSubmitted }: { request: (values: Record<string, string>) => WriteRequest; children: ReactNode; submitLabel?: string; onSubmitted?: () => void }) {
  const { submitWrite, wallet } = usePavel();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<WriteRequest>();
  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
    try { setPending(request(normalized)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to prepare transaction"); }
  }
  async function confirm() {
    if (!pending) return;
    setBusy(true);
    const tracked = await submitWrite(pending);
    setBusy(false);
    if (tracked) { setPending(undefined); onSubmitted?.(); }
  }
  return <><form className="surface form-grid" onSubmit={(event) => void prepare(event)}>{children}<p className="form-note">{wallet.status === "CONNECTED" ? "Review the target state, then approve one wallet transaction. PAVEL tracks the returned ID." : "Connect a Studionet wallet before signing."}</p>{error ? <p className="form-error">{error}</p> : null}<div className="form-actions"><button className="button button-primary" type="submit" disabled={wallet.status !== "CONNECTED"}>{submitLabel}</button></div></form>{pending ? <ReviewDialog request={pending} busy={busy} onCancel={() => setPending(undefined)} onConfirm={() => void confirm()} /> : null}</>;
}

export function WriteButton({ request, label, disabled, onSubmitted }: { request: WriteRequest; label: string; disabled?: boolean; onSubmitted?: () => void }) {
  const { submitWrite, wallet } = usePavel();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  async function confirm() {
    setBusy(true);
    const tracked = await submitWrite(request);
    setBusy(false);
    if (tracked) { setPending(false); onSubmitted?.(); }
  }
  return <>{pending ? <ReviewDialog request={request} busy={busy} onCancel={() => setPending(false)} onConfirm={() => void confirm()} /> : <button className="button button-primary" type="button" disabled={disabled || busy || wallet.status !== "CONNECTED"} onClick={() => setPending(true)}>{busy ? "Preparing…" : label}</button>}</>;
}
