import type { Address } from "./types";
import { CORE_ADDRESS, VAULT_ADDRESS } from "./network";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const historicalAddresses = new Set([
  "0x572773e2ab38aa5a546bcfc50be25f209fb19159",
  "0x93541666268fcc02a2087b9275731aabeb78826f",
]);

function configuredAddress(value: string | undefined, label: string): Address | undefined {
  if (!value) return undefined;
  if (!addressPattern.test(value)) throw new Error(`PAVEL configuration: ${label} is malformed`);
  if (historicalAddresses.has(value.toLowerCase())) throw new Error(`PAVEL configuration: ${label} points to historical qualification-v1 state`);
  return value as Address;
}

export function configuredContracts() {
  return {
    core: configuredAddress(process.env.NEXT_PUBLIC_PAVEL_CORE_ADDRESS ?? CORE_ADDRESS, "Core address"),
    vault: configuredAddress(process.env.NEXT_PUBLIC_PAVEL_VAULT_ADDRESS ?? VAULT_ADDRESS, "Vault address"),
  };
}

export function qualificationLabel(): string {
  return configuredContracts().core && configuredContracts().vault ? "Live V7 Core/Vault pair is source-verified on Studionet 61999." : "No contract addresses configured. This UI will not fabricate chain state.";
}
