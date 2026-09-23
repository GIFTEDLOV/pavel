import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = resolve(process.cwd(), "deployments/studionet/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const required = ["network", "rpc", "chainId", "currency", "explorer", "deployed", "version", "coreAddress", "vaultAddress", "sourceHashes", "authorizationSchema", "fulfillmentSchema", "qualificationState"];
for (const key of required) if (!(key in manifest)) throw new Error(`manifest missing ${key}`);
if (manifest.network !== "studionet" || manifest.rpc !== "https://studio.genlayer.com/api" || manifest.chainId !== 61999 || manifest.currency !== "GEN") throw new Error("manifest is not canonical Studionet");
if (manifest.deployed !== true || manifest.version !== "V7") throw new Error("manifest must describe the verified V7 deployment");
if (manifest.coreAddress !== "0xBA2356FfE5062506FA938da4715c03a2BE7929bF" || manifest.vaultAddress !== "0x552167Cc0883D02ce42fA2aD64E29Cd10EE3eDFD") throw new Error("manifest addresses do not match the verified V7 deployment");
if (JSON.stringify(manifest.sourceHashes) !== JSON.stringify({core: "4acc04c4b684b35058b793973eec75569af9e981eb84d33167198615255b785a", vault: "f671005e07a658a17a7711807d23fa56bf0d6e2e85d0a266eafc17b03455f15c"})) throw new Error("manifest source hashes do not match V7");
if (manifest.authorizationSchema !== "pavel-authorization-v2" || manifest.fulfillmentSchema !== "pavel-fulfillment-v2") throw new Error("manifest schemas do not match V7");
if (manifest.qualificationState !== "FULFILLED_RELEASE_PENDING_EXTERNAL_UNCONFIRMED") throw new Error("manifest qualification state is not truthful");
console.log(JSON.stringify({ ok: true, deployed: true, version: manifest.version, network: manifest.network, chainId: manifest.chainId, qualificationState: manifest.qualificationState }, null, 2));
