import { studionet } from "genlayer-js/chains";
import type { Address } from "./types";

export const PAVEL_NETWORK = {
  alias: "studionet" as const,
  rpcUrl: "https://studio.genlayer.com/api" as const,
  chainId: 61999 as const,
  currency: "GEN" as const,
  explorer: "https://explorer-studio.genlayer.com" as const,
};

export const CORE_ADDRESS: Address = "0x1540cEa5d3Df622068B2d3A22aac8Bcb31B900f4";
export const VAULT_ADDRESS: Address = "0xac43A164AB9e82d7Af387059c04579FE48050fce";

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
