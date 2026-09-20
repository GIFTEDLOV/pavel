import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AGENT = "0xcb5a845638cbc1f95d7f8343278685682c3ba13f";
const METHOD = "create_mandate";

/**
 * The stable CLI exposes a Commander variadic option. A standalone empty
 * PowerShell argv value is lost before Commander receives it; --args= is a
 * non-empty argv token whose option value is the empty string.
 */
export function buildRootMandateCliArgv(agent = AGENT) {
  return ["--args", agent, "--args="];
}

export function buildRootMandateSemanticCall(agent = AGENT) {
  return {
    method: METHOD,
    args: [
      { type: "Address", value: agent.toLowerCase() },
      "",
    ],
  };
}

function parsePinnedCliArgs(argv) {
  const args = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--args") {
      if (index + 1 >= argv.length) throw new Error("--args requires a value");
      args.push(parsePinnedScalar(argv[++index]));
      continue;
    }
    if (token.startsWith("--args=")) {
      args.push(parsePinnedScalar(token.slice("--args=".length)));
    }
  }
  return args;
}

function parsePinnedScalar(value) {
  if (/^0x[0-9a-fA-F]{40}$/.test(value) || /^addr#[0-9a-fA-F]{40}$/.test(value)) {
    return { type: "Address", value: value.replace(/^addr#/i, "0x").toLowerCase() };
  }
  return value;
}

function assertCall(call) {
  if (call.method !== METHOD) throw new Error("unexpected root mandate method");
  if (call.args.length !== 2) throw new Error(`expected two arguments, got ${call.args.length}`);
  if (call.args[0]?.type !== "Address" || call.args[0]?.value !== AGENT) {
    throw new Error("authorized agent calldata is not the expected Address");
  }
  if (typeof call.args[1] !== "string" || call.args[1] !== "") {
    throw new Error("root parent_mandate_id is not the exact empty string");
  }
}

function findStableCliSource() {
  const pnpmRoot = path.join(ROOT, "node_modules", ".pnpm");
  const entry = fs.readdirSync(pnpmRoot).find((name) => name.startsWith("genlayer@0.39.2_"));
  if (!entry) throw new Error("pinned genlayer 0.39.2 package not found");
  return path.join(pnpmRoot, entry, "node_modules", "genlayer", "src", "commands", "contracts", "index.ts");
}

export function runQualificationCallDataRegression() {
  const source = fs.readFileSync(findStableCliSource(), "utf8");
  if (!source.includes('.option("--args <args...>"')) throw new Error("stable CLI args option changed");
  if (!source.includes("return [...previous, parseScalar(value)]")) throw new Error("stable CLI scalar parser changed");

  const droppedByShell = parsePinnedCliArgs(["--args", AGENT]);
  if (droppedByShell.length !== 1) throw new Error("control case did not model the dropped shell argument");

  const corrected = buildRootMandateSemanticCall(AGENT);
  const parsedCorrected = parsePinnedCliArgs(buildRootMandateCliArgv(AGENT));
  if (parsedCorrected.length !== 2 || parsedCorrected[1] !== "") {
    throw new Error("--args= did not preserve the second empty string");
  }
  assertCall(corrected);
  if (parsedCorrected[0]?.type !== "Address" || parsedCorrected[0]?.value !== AGENT) {
    throw new Error("corrected CLI Address argument did not remain typed");
  }
  return {
    method: METHOD,
    cliArgv: buildRootMandateCliArgv(AGENT),
    corrected,
    argumentCount: parsedCorrected.length,
    arg0Type: parsedCorrected[0].type,
    arg0Value: parsedCorrected[0].value,
    arg1Type: typeof parsedCorrected[1],
    arg1Value: parsedCorrected[1],
    emptyStringPreserved: true,
    standaloneEmptyArgControlCount: droppedByShell.length,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const proof = runQualificationCallDataRegression();
  console.log(`CALLDATA_REGRESSION: passed (${proof.argumentCount} args; arg1 is an explicit empty string)`);
  console.log(JSON.stringify(proof, null, 2));
}
