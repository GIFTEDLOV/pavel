"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { usePavel, type WriteRequest } from "./pavel-provider";

export function WriteForm({ request, children, submitLabel = "Review and sign", onSubmitted }: { request: (values: Record<string, string>) => WriteRequest; children: ReactNode; submitLabel?: string; onSubmitted?: () => void }) {
  const { submitWrite, wallet } = usePavel();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
    try {
      setBusy(true);
      const tracked = await submitWrite(request(normalized));
      if (tracked) onSubmitted?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to prepare transaction");
    } finally {
      setBusy(false);
    }
  }
  return <form className="surface form-grid" onSubmit={(event) => void submit(event)}>{children}<p className="form-note">{wallet.status === "CONNECTED" ? "Review the target state, then approve one wallet transaction. PAVEL tracks the returned ID." : "Connect a Studionet wallet before signing."}</p>{error ? <p className="form-error">{error}</p> : null}<div className="form-actions"><button className="button button-primary" type="submit" disabled={busy || wallet.status !== "CONNECTED"}>{busy ? "Preparing…" : submitLabel}</button></div></form>;
}

export function WriteButton({ request, label, disabled, onSubmitted }: { request: WriteRequest; label: string; disabled?: boolean; onSubmitted?: () => void }) {
  const { submitWrite, wallet } = usePavel();
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    const tracked = await submitWrite(request);
    setBusy(false);
    if (tracked) onSubmitted?.();
  }
  return <button className="button button-primary" type="button" disabled={disabled || busy || wallet.status !== "CONNECTED"} onClick={() => void submit()}>{busy ? "Preparing…" : label}</button>;
}
