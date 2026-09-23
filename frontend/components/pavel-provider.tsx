"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { type WalletProvider } from "@/lib/genlayer/client";
import { readProtocolSnapshot, type ProtocolSnapshot } from "@/lib/pavel/reads";
import { PAVEL_NETWORK } from "@/lib/pavel/network";
import { reconcileTransaction, writeOnce, type TrackedWrite } from "@/lib/genlayer/transactions";
import type { Address } from "@/lib/pavel/types";

declare global { interface Window { ethereum?: ProviderEvent } }

type WalletStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "WRONG_NETWORK" | "ERROR";
type ProviderEvent = WalletProvider & { on?: (event: string, handler: (...args: unknown[]) => void) => void; removeListener?: (event: string, handler: (...args: unknown[]) => void) => void };
type TxStage = "REVIEW" | "AWAITING_SIGNATURE" | "TX_ID_RECEIVED" | "FINALIZING" | "FINALIZED_SUCCESS" | "CANONICAL_VERIFIED" | "EXECUTION_FAILED" | "AMBIGUOUS";

export interface WriteRequest {
  actionKey: string;
  contract: Address;
  method: string;
  args: readonly unknown[];
  value?: bigint;
  targetState?: string;
}

export interface ActiveTransaction extends WriteRequest {
  hash?: string;
  explorerUrl?: string;
  stage: TxStage;
  error?: string;
}

function verifyCanonicalPostcondition(request: WriteRequest, snapshot: ProtocolSnapshot): boolean {
  const id = String(request.args[0] ?? "");
  const intent = snapshot.intents.find((item) => item.intent_id === id);
  const mandate = snapshot.mandates.find((item) => item.mandate_id === id);
  switch (request.method) {
    case "authorize_intent": return Boolean(snapshot.authorizations[id]?.authorization_decision === "AUTHORIZED" || intent?.status === "REJECTED");
    case "reserve": return snapshot.reservations[id]?.status === "RESERVED";
    case "request_release": return snapshot.reservations[id]?.status === "RELEASE_PENDING" && snapshot.settlements[id]?.direction === "RELEASE_TO_COUNTERPARTY";
    case "request_refund": return snapshot.reservations[id]?.status === "REFUND_PENDING" && snapshot.settlements[id]?.direction === "REFUND_TO_PRINCIPAL";
    case "submit_intent": return intent?.status === "SUBMITTED";
    case "stage_evidence": return intent?.status === "EVIDENCE_READY" || intent?.status === "FULFILLMENT_PENDING";
    case "start_fulfillment": return intent?.status === "FULFILLMENT_PENDING";
    case "assess_fulfillment": return ["FULFILLED", "NOT_FULFILLED", "FULFILLMENT_RETRY_REQUIRED"].includes(intent?.status ?? "");
    case "seal_mandate": return mandate?.status === "SEALED";
    case "configure_mandate": return Boolean(mandate && mandate.status === "DRAFT");
    case "deposit": return Boolean(snapshot.accounting[id] && BigInt(snapshot.accounting[id]?.deposited ?? "0") > 0n);
    default: return false;
  }
}

interface PavelContextValue {
  wallet: { status: WalletStatus; address?: Address; chainId?: number; error?: string };
  connectWallet: () => Promise<void>;
  switchToStudionet: () => Promise<void>;
  disconnectWallet: () => void;
  snapshot?: ProtocolSnapshot;
  snapshotLoading: boolean;
  snapshotError?: string;
  refreshSnapshot: (options?: { intentId?: string; mandateId?: string }) => Promise<ProtocolSnapshot | undefined>;
  submitWrite: (request: WriteRequest) => Promise<TrackedWrite | undefined>;
  trackTransaction: (hash: string, request?: WriteRequest) => Promise<void>;
  activeTransaction?: ActiveTransaction;
  dismissTransaction: () => void;
}

const PavelContext = createContext<PavelContextValue | undefined>(undefined);

const targetChain = `0x${PAVEL_NETWORK.chainId.toString(16)}`;

function providerFromWindow(): ProviderEvent | undefined {
  if (typeof window === "undefined") return undefined;
  return window.ethereum as ProviderEvent | undefined;
}

function toAddress(value: unknown): Address | undefined {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) ? value as Address : undefined;
}

export function PavelProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<PavelContextValue["wallet"]>({ status: "DISCONNECTED" });
  const [snapshot, setSnapshot] = useState<ProtocolSnapshot>();
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState<string>();
  const [activeTransaction, setActiveTransaction] = useState<ActiveTransaction>();

  const refreshSnapshot = useCallback(async (options: { intentId?: string; mandateId?: string } = {}) => {
    setSnapshotLoading(true);
    setSnapshotError(undefined);
    try {
      const next = await readProtocolSnapshot(options);
      setSnapshot(next);
      return next;
    } catch (cause) {
      setSnapshotError(cause instanceof Error ? cause.message : "Studionet read unavailable");
      return undefined;
    } finally {
      setSnapshotLoading(false);
    }
  }, []);

  const syncWallet = useCallback(async () => {
    const provider = providerFromWindow();
    if (!provider) return;
    try {
      const [accounts, chain] = await Promise.all([
        provider.request({ method: "eth_accounts" }),
        provider.request({ method: "eth_chainId" }),
      ]);
      const address = Array.isArray(accounts) ? toAddress(accounts[0]) : undefined;
      const chainId = typeof chain === "string" ? Number.parseInt(chain, 16) : undefined;
      setWallet({ status: address && chainId === PAVEL_NETWORK.chainId ? "CONNECTED" : address ? "WRONG_NETWORK" : "DISCONNECTED", address, chainId });
    } catch (cause) {
      setWallet({ status: "ERROR", error: cause instanceof Error ? cause.message : "Wallet state unavailable" });
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => { void refreshSnapshot(); void syncWallet(); }, 0);
    const provider = providerFromWindow();
    if (!provider?.on) return () => window.clearTimeout(kickoff);
    const accountsChanged = () => void syncWallet();
    const chainChanged = () => void syncWallet();
    provider.on("accountsChanged", accountsChanged);
    provider.on("chainChanged", chainChanged);
    return () => {
      window.clearTimeout(kickoff);
      provider.removeListener?.("accountsChanged", accountsChanged);
      provider.removeListener?.("chainChanged", chainChanged);
    };
  }, [refreshSnapshot, syncWallet]);

  const switchToStudionet = useCallback(async () => {
    const provider = providerFromWindow();
    if (!provider) throw new Error("No wallet provider detected. Install or unlock a browser wallet.");
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetChain }] });
    } catch (cause) {
      const code = typeof cause === "object" && cause !== null && "code" in cause ? (cause as { code?: number }).code : undefined;
      if (code !== 4902) throw cause;
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: targetChain, chainName: "GenLayer Studionet", nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 }, rpcUrls: [PAVEL_NETWORK.rpcUrl], blockExplorerUrls: [PAVEL_NETWORK.explorer] }] });
    }
    await syncWallet();
  }, [syncWallet]);

  const connectWallet = useCallback(async () => {
    const provider = providerFromWindow();
    if (!provider) {
      setWallet({ status: "ERROR", error: "No browser wallet detected" });
      return;
    }
    setWallet((current) => ({ ...current, status: "CONNECTING", error: undefined }));
    try {
      await provider.request({ method: "eth_requestAccounts" });
      await syncWallet();
    } catch (cause) {
      setWallet({ status: "ERROR", error: cause instanceof Error ? cause.message : "Wallet connection rejected" });
    }
  }, [syncWallet]);

  const disconnectWallet = useCallback(() => setWallet({ status: "DISCONNECTED" }), []);

  const trackTransaction = useCallback(async (hash: string, request?: WriteRequest) => {
    setActiveTransaction((current) => current ? { ...current, stage: "FINALIZING" } : current);
    const result = await reconcileTransaction(hash);
    setActiveTransaction((current) => {
      if (!current || current.hash !== hash) return current;
      if (result === "FINALIZED") return { ...current, stage: "FINALIZED_SUCCESS" };
      if (result === "EXECUTION_FAILED") return { ...current, stage: "EXECUTION_FAILED", error: "The transaction finalized with an execution error. No canonical success is assumed." };
      if (result === "AMBIGUOUS") return { ...current, stage: "AMBIGUOUS", error: "Polling was inconclusive. The same transaction ID remains authoritative." };
      return { ...current, stage: "FINALIZING" };
    });
    if (result === "FINALIZED") {
      const refreshed = await refreshSnapshot({ intentId: request?.method === "reserve" || request?.method === "authorize_intent" || request?.method === "submit_intent" || request?.method === "stage_evidence" || request?.method === "assess_fulfillment" || request?.method === "start_fulfillment" ? String(request.args[0] ?? "") : undefined, mandateId: request?.method === "deposit" ? String(request.args[0] ?? "") : undefined });
      const verified = request && refreshed ? verifyCanonicalPostcondition(request, refreshed) : false;
      setActiveTransaction((current) => current && current.hash === hash ? { ...current, stage: verified ? "CANONICAL_VERIFIED" : "FINALIZED_SUCCESS", error: verified ? undefined : "Execution finalized; latest-final state was refreshed, but this action has no automatic postcondition proof." } : current);
    }
  }, [refreshSnapshot]);

  const submitWrite = useCallback(async (request: WriteRequest) => {
    if (wallet.status !== "CONNECTED" || !wallet.address) {
      setActiveTransaction({ ...request, stage: "EXECUTION_FAILED", error: "Connect a wallet on Studionet before signing." });
      return undefined;
    }
    const provider = providerFromWindow();
    if (!provider) {
      setActiveTransaction({ ...request, stage: "EXECUTION_FAILED", error: "The wallet provider disappeared before signing." });
      return undefined;
    }
    setActiveTransaction({ ...request, stage: "AWAITING_SIGNATURE" });
    try {
      await switchToStudionet();
      const tracked = await writeOnce({ actionKey: request.actionKey, account: wallet.address, contract: request.contract, method: request.method, args: request.args, provider, write: { address: request.contract, functionName: request.method, args: [...request.args], value: request.value ?? 0n } });
      setActiveTransaction({ ...request, ...tracked, stage: "TX_ID_RECEIVED" });
      void trackTransaction(tracked.hash, request);
      return tracked;
    } catch (cause) {
      setActiveTransaction({ ...request, stage: "EXECUTION_FAILED", error: cause instanceof Error ? cause.message : "Wallet write failed" });
      return undefined;
    }
  }, [trackTransaction, switchToStudionet, wallet.address, wallet.status]);

  const value = useMemo<PavelContextValue>(() => ({ wallet, connectWallet, switchToStudionet, disconnectWallet, snapshot, snapshotLoading, snapshotError, refreshSnapshot, submitWrite, trackTransaction, activeTransaction, dismissTransaction: () => setActiveTransaction(undefined) }), [activeTransaction, connectWallet, disconnectWallet, refreshSnapshot, snapshot, snapshotError, snapshotLoading, submitWrite, switchToStudionet, trackTransaction, wallet]);
  return <PavelContext.Provider value={value}>{children}</PavelContext.Provider>;
}

export function usePavel(): PavelContextValue {
  const value = useContext(PavelContext);
  if (!value) throw new Error("usePavel must be used inside PavelProvider");
  return value;
}
