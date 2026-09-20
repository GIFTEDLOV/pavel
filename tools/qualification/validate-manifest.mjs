import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = resolve(process.cwd(), "deployments/studionet/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const required = ["network", "rpc", "chainId", "currency", "explorer", "deployed", "coreAddress", "vaultAddress", "sourceHashes"];
for (const key of required) if (!(key in manifest)) throw new Error(`manifest missing ${key}`);
if (manifest.network !== "studionet" || manifest.rpc !== "https://studio.genlayer.com/api" || manifest.chainId !== 61999 || manifest.currency !== "GEN") throw new Error("manifest is not canonical Studionet");
if (manifest.deployed !== false) throw new Error("Phase 1 manifest must not claim deployment");
if (manifest.coreAddress !== null || manifest.vaultAddress !== null) throw new Error("Phase 1 manifest must not contain fabricated addresses");
if (typeof manifest.sourceHashes !== "object" || Array.isArray(manifest.sourceHashes)) throw new Error("sourceHashes must be an object");
console.log(JSON.stringify({ ok: true, deployed: false, network: manifest.network, chainId: manifest.chainId }, null, 2));
