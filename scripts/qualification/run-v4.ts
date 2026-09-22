import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ARTIFACT_DIR = path.join(ROOT, "artifacts", "studionet", "qualification-v4");
const CORE_SOURCE = path.join(ROOT, "contracts", "pavel_core.py");
const VAULT_SOURCE = path.join(ROOT, "contracts", "pavel_vault.py");
const CORE_SHA = "6ece0d1aae99ccbd734b97802c9ca2481a38264da593b43ca8a5d7ab188c7053";
const VAULT_SHA = "d967d6f1e70cd698fc428338ca822c5541ce07fd7977517db7bb19f9796aa8ed";

function sha256(file: string) { return createHash("sha256").update(readFileSync(file)).digest("hex"); }
function git(args: string[]) { return execFileSync("git", args, {cwd: ROOT, encoding: "utf8"}).trim(); }
function writeLocal(name: string, value: unknown) {
  mkdirSync(ARTIFACT_DIR, {recursive: true});
  writeFileSync(path.join(ARTIFACT_DIR, name), JSON.stringify(value, null, 2) + "\n");
}

function freezeV4Source() {
  const actualCore = sha256(CORE_SOURCE);
  const actualVault = sha256(VAULT_SOURCE);
  if (actualCore !== CORE_SHA || actualVault !== VAULT_SHA) throw new Error(`V4 source hash mismatch: core=${actualCore} vault=${actualVault}`);
  const head = git(["rev-parse", "HEAD"]);
  const status = git(["status", "--short"]);
  if (status !== "") throw new Error(`V4 requires a clean worktree before network writes: ${status}`);
  writeLocal("source-freeze.json", {
    qualificationVersion: "qualification-v4",
    network: "studionet",
    chainId: 61999,
    gitHead: head,
    worktree: "CLEAN",
    core: {path: "contracts/pavel_core.py", sha256: actualCore},
    vault: {path: "contracts/pavel_vault.py", sha256: actualVault},
    frozenAt: new Date().toISOString(),
  });
}

freezeV4Source();
process.env.PAVEL_QUALIFICATION_VERSION = "qualification-v4";
process.env.PAVEL_CORE_SHA = CORE_SHA;
process.env.PAVEL_VAULT_SHA = VAULT_SHA;
process.env.PAVEL_ARTIFACT_DIR = ARTIFACT_DIR;
process.env.PAVEL_STATE_FILE = "checkpoint.json";
process.env.PAVEL_TRANSACTION_FILE = "transaction-ledger.json";

// The comprehensive preflight is a zero-write gate. It must pass before the
// lifecycle runner is imported and before any secure password prompt can occur.
execFileSync(process.execPath, ["--experimental-strip-types", path.join(ROOT, "scripts", "qualification", "preflight-v4.ts")], {cwd: ROOT, stdio: "inherit"});

const {runQualification} = await import("./run-v3.ts");
await runQualification();
