import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { assertPavelNetwork } from "@/lib/pavel/network";

export type WalletProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

export type PavelClient = ReturnType<typeof createClient>;

export function createPavelClient(account?: `0x${string}`, provider?: WalletProvider): PavelClient {
  assertPavelNetwork();
  return createClient({ chain: studionet, ...(account ? { account } : {}), ...(provider ? { provider: provider as never } : {}) });
}

export function connectedAccount(): `0x${string}` | undefined {
  if (typeof window === "undefined") return undefined;
  return undefined;
}
