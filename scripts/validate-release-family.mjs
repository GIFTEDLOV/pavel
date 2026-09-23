import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");
const json = (relative) => JSON.parse(read(relative));
const assert = (condition, message) => {
  if (!condition) throw new Error(`RELEASE_FAMILY_VALIDATION: ${message}`);
};

const family = json("docs/genlayer-release-family.json");
const frontendPackage = json("frontend/package.json");
const feeDocs = read("docs/TRANSACTION_FEES.md");
const networkSource = read("frontend/lib/pavel/network.ts");

assert(family.network === "studionet", "network must remain studionet");
assert(family.chainId === 61999, "chainId must remain 61999");
assert(family.genlayerJs === "1.1.8", "compatibility record must pin genlayer-js 1.1.8");
assert(frontendPackage.dependencies?.["genlayer-js"] === "1.1.8", "frontend genlayer-js dependency drifted");
assert(networkSource.includes("chainId: 61999"), "frontend network chain drifted");
assert(networkSource.includes("https://studio.genlayer.com/api"), "frontend RPC drifted");
assert(family.consensusFamily === "stable-pre-v0.6", "unexpected release family");
assert(family.v06FeeProfileApi === false, "v0.6 fee API cannot be marked available on stable 1.1.8");
assert(family.studioDevMigrationRequiredForV06Rc === true, "v0.6 RC migration boundary missing");
for (const api of ["getCurrentFeePolicy", "estimateTransactionFees", "estimateTransactionFeesForWrite", "TransactionFeeOptions"]) {
  assert(family.stableCapabilities?.[api] === false, `${api} must be unavailable in stable 1.1.8`);
}
assert(feeDocs.includes("genlayer-js` `1.1.8"), "fee docs must identify stable 1.1.8");
assert(feeDocs.includes("Studionet (`chainId` `61999`)"), "fee docs must identify Studionet 61999");
assert(feeDocs.includes("does not expose"), "fee docs must describe unavailable v0.6 APIs");
assert(feeDocs.includes("does not mix that family"), "fee docs must state the RC family boundary");
assert(!/v1\.1\.8[^\n]*(?:exposes|implements)[^\n]*(?:getCurrentFeePolicy|estimateTransactionFees)/i.test(feeDocs), "fee docs falsely claim v0.6 fee APIs are exposed");

console.log("RELEASE_FAMILY_COMPATIBILITY: passed (stable Studionet 61999 / genlayer-js 1.1.8; v0.6 RC APIs excluded)");
