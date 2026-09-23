import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeTests = [
  "scripts/qualification/account-resolution-regression.mjs",
  "scripts/qualification/confirmation-regression.mjs",
  "scripts/qualification/reconciliation-regression.mjs",
  "scripts/qualification/v3-runner-regression.mjs",
  "scripts/qualification/v4-runner-regression.mjs",
  "scripts/qualification/v4-remaining-lifecycle-regression.mjs",
  "scripts/qualification/finish-v4-regression.mjs",
  "scripts/qualification/official-transaction-regression.mjs",
  "scripts/qualification/checkpoint-retry-regression.mjs",
  "scripts/qualification/v5-runner-regression.mjs",
  "scripts/qualification/v6-authorization-regression.mjs",
  "scripts/qualification/v6-live-resume-regression.mjs",
  "scripts/qualification/deployment-reconciliation-regression.mjs",
  "scripts/qualification/v7-fulfillment-regression.mjs",
  "scripts/qualification/v7-fulfillment-mutation.mjs",
];

const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", ...nodeTests], {cwd: root, stdio: "inherit"});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
