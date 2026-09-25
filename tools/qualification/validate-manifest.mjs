import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = resolve(process.cwd(), "deployments/studionet/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const required = ["network", "rpc", "chainId", "currency", "explorer", "deployed", "version", "coreAddress", "vaultAddress", "sourceHashes", "authorizationSchema", "fulfillmentSchema", "qualificationState", "challengeFlowVerification", "fulfillmentGateVerification", "externalSettlementObservation", "proofPackage"];
for (const key of required) if (!(key in manifest)) throw new Error(`manifest missing ${key}`);
if (manifest.network !== "studionet" || manifest.rpc !== "https://studio.genlayer.com/api" || manifest.chainId !== 61999 || manifest.currency !== "GEN") throw new Error("manifest is not canonical Studionet");
if (manifest.deployed !== true || manifest.version !== "V8") throw new Error("manifest must describe the verified V8 deployment");
if (manifest.coreAddress !== "0x1540cEa5d3Df622068B2d3A22aac8Bcb31B900f4" || manifest.vaultAddress !== "0xac43A164AB9e82d7Af387059c04579FE48050fce") throw new Error("manifest addresses do not match the verified V8 deployment");
if (JSON.stringify(manifest.sourceHashes) !== JSON.stringify({core: "1636cc81461b5536103add686586308a05f599740a4e625e00825d8d11401e60", vault: "f671005e07a658a17a7711807d23fa56bf0d6e2e85d0a266eafc17b03455f15c"})) throw new Error("manifest source hashes do not match V8");
if (manifest.authorizationSchema !== "pavel-authorization-v2" || manifest.fulfillmentSchema !== "pavel-fulfillment-v2") throw new Error("manifest schemas do not match V8");
if (manifest.qualificationState !== "FULFILLED_RELEASE_PENDING_EXTERNAL_UNCONFIRMED") throw new Error("manifest qualification state is not truthful");
if (manifest.challengeFlowVerification?.qualifyingChallengeBlocksSettlement !== true || manifest.challengeFlowVerification?.settlementStatus !== "CHALLENGE_BLOCKED" || manifest.challengeFlowVerification?.settlementDirectionWhileBlocked !== "" || manifest.challengeFlowVerification?.expiryProof !== "PASS") throw new Error("manifest challenge verification is not complete");
if (manifest.fulfillmentGateVerification?.sequenceOneAuthenticatedBeforeAssessment !== true || manifest.fulfillmentGateVerification?.directModeGuard !== "PASS") throw new Error("manifest fulfillment gate verification is not complete");
if (manifest.externalSettlementObservation !== "UNCONFIRMED") throw new Error("manifest external settlement observation is not truthful");
console.log(JSON.stringify({ ok: true, deployed: true, version: manifest.version, network: manifest.network, chainId: manifest.chainId, qualificationState: manifest.qualificationState }, null, 2));
