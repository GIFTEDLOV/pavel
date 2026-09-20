import { studionet } from "genlayer-js/chains";
import type { Address } from "./types";

export const PAVEL_NETWORK = {
  alias: "studionet" as const,
  rpcUrl: "https://studio.genlayer.com/api" as const,
  chainId: 61999 as const,
  currency: "GEN" as const,
  explorer: "https://explorer-studio.genlayer.com" as const,
};

export const CORE_ADDRESS: Address | undefined = undefined;
export const VAULT_ADDRESS: Address | undefined = undefined;

export function assertPavelNetwork(): void {
  const chain = studionet as { id?: number; rpcUrls?: { default?: { http?: readonly string[] } } };
  if (chain.id !== PAVEL_NETWORK.chainId) throw new Error("PAVEL network guard: SDK chain is not Studionet 61999");
  const rpc = chain.rpcUrls?.default?.http?.[0];
  if (rpc !== PAVEL_NETWORK.rpcUrl) throw new Error("PAVEL network guard: SDK RPC is not canonical Studionet");
  if (/studio-dev|studio-next/i.test(rpc ?? "")) throw new Error("PAVEL network guard: preview RPC is forbidden");
}

export function explorerTransactionUrl(hash: string): string {
  return `${PAVEL_NETWORK.explorer}/tx/${hash}`;
}
