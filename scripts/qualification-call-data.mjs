import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AGENT = "0xcb5a845638cbc1f95d7f8343278685682c3ba13f";
const METHOD = "create_mandate";

function findStableCliSource() {
  const pnpmRoot = path.join(ROOT, "node_modules", ".pnpm");
  const entry = fs.readdirSync(pnpmRoot).find((name) => name.startsWith("genlayer@0.39.2_"));
  if (!entry) throw new Error("pinned genlayer 0.39.2 package not found");
  return path.join(pnpmRoot, entry, "node_modules", "genlayer", "src", "commands", "contracts", "index.ts");
}

function findStableCliBundle() {
  const pnpmRoot = path.join(ROOT, "node_modules", ".pnpm");
  const entry = fs.readdirSync(pnpmRoot).find((name) => name.startsWith("genlayer@0.39.2_"));
  if (!entry) throw new Error("pinned genlayer 0.39.2 package not found");
  return path.join(pnpmRoot, entry, "node_modules", "genlayer", "dist", "index.js");
}

function findStableSdkIndex() {
  const sdkPath = path.join(ROOT, "frontend", "node_modules", "genlayer-js", "dist", "index.js");
  if (!fs.existsSync(sdkPath)) throw new Error("pinned genlayer-js 1.1.8 package not found");
  return sdkPath;
}

function findStableSdkTypes() {
  return path.join(ROOT, "frontend", "node_modules", "genlayer-js", "dist", "types", "index.js");
}

async function loadPinnedCliParser() {
  const {CalldataAddress} = await loadPinnedSdk();
  const bundle = fs.readFileSync(findStableCliBundle(), "utf8");
  const start = bundle.indexOf("var ADDRESS_RE =");
  const end = bundle.indexOf("var FEES_HELP =", start);
  if (start < 0 || end < 0) throw new Error("could not locate the bundled stable CLI parser");
  const parserSource = bundle.slice(start, end);
  const context = {CalldataAddress, Uint8Array, BigInt, Number, JSON, Object, Array, isNaN, console};
  vm.runInNewContext(`${parserSource}\nglobalThis.__pavelParseScalar = parseScalar;\nglobalThis.__pavelParseArg = parseArg;`, context);
  return {
    parseScalar: context.__pavelParseScalar,
    parseArg: context.__pavelParseArg,
    source: parserSource,
    bundle: findStableCliBundle(),
  };
}

async function loadPinnedSdk() {
  const sdk = await import(pathToFileURL(findStableSdkIndex()).href);
  const types = await import(pathToFileURL(findStableSdkTypes()).href);
  return {abi: sdk.abi, CalldataAddress: types.CalldataAddress};
}

function summarize(value) {
  if (value && value.constructor?.name === "CalldataAddress" && value.bytes instanceof Uint8Array) {
    return {type: "Address", value: `0x${Buffer.from(value.bytes).toString("hex")}`};
  }
  if (value instanceof Uint8Array) return {type: "bytes", value: Array.from(value)};
  if (typeof value === "bigint") return {type: "bigint", value: value.toString()};
  if (Array.isArray(value)) return value.map(summarize);
  if (value === null) return {type: "null", value: null};
  return {type: typeof value, value};
}

function parseCommanderArgs(parseArg, argv) {
  const parsed = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--args") {
      if (index + 1 >= argv.length) throw new Error("--args requires a value");
      const next = parseArg(argv[++index], parsed);
      parsed.splice(0, parsed.length, ...next);
      continue;
    }
    if (token.startsWith("--args=")) {
      const next = parseArg(token.slice("--args=".length), parsed);
      parsed.splice(0, parsed.length, ...next);
    }
  }
  return parsed;
}

function cliValueToSdkValue(value, CalldataAddress) {
  if (value instanceof CalldataAddress) return value;
  if (value && value.constructor?.name === "CalldataAddress" && value.bytes instanceof Uint8Array) {
    return new CalldataAddress(value.bytes);
  }
  if (Array.isArray(value)) return value.map((item) => cliValueToSdkValue(item, CalldataAddress));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cliValueToSdkValue(item, CalldataAddress)]));
  }
  return value;
}

function encodeCandidate(abi, CalldataAddress, args) {
  const sdkArgs = args.map((value) => cliValueToSdkValue(value, CalldataAddress));
  const object = abi.calldata.makeCalldataObject(METHOD, sdkArgs, undefined);
  const bytes = abi.calldata.encode(object);
  const decoded = abi.calldata.decode(bytes);
  return {
    calldataString: abi.calldata.toString(object),
    encodedBytes: Array.from(bytes),
    decodedString: abi.calldata.toString(decoded),
    decoded: decoded instanceof Map ? Object.fromEntries(decoded.entries()) : decoded,
  };
}

function describeCandidate(abi, CalldataAddress, parseArg, name, argv) {
  const args = parseCommanderArgs(parseArg, argv);
  return {
    name,
    rawArgv: argv,
    parserArgs: args.map(summarize),
    finalCalldata: encodeCandidate(abi, CalldataAddress, args),
  };
}

export function buildRootMandateSdkArgs(CalldataAddress) {
  const addressBytes = Uint8Array.from(Buffer.from(AGENT.slice(2), "hex"));
  return [new CalldataAddress(addressBytes), ""];
}

export async function runQualificationCallDataRegression() {
  const cli = await loadPinnedCliParser();
  const {abi, CalldataAddress} = await loadPinnedSdk();
  const source = fs.readFileSync(findStableCliSource(), "utf8");
  if (!source.includes('.option("--args <args...>"')) throw new Error("stable CLI args option changed");
  if (!source.includes("if (!isNaN(Number(value)) && Number.isSafeInteger(Number(value))) return Number(value);")) {
    throw new Error("stable CLI scalar coercion source changed");
  }

  const candidates = [
    describeCandidate(abi, CalldataAddress, cli.parseArg, "standalone-empty-token-if-forwarded", ["--args", AGENT, "--args", ""]),
    describeCandidate(abi, CalldataAddress, cli.parseArg, "explicit-empty-option", ["--args", AGENT, "--args="]),
    describeCandidate(abi, CalldataAddress, cli.parseArg, "literal-quote-pair", ["--args", AGENT, '--args=""']),
    describeCandidate(abi, CalldataAddress, cli.parseArg, "space", ["--args", AGENT, "--args= "]),
    describeCandidate(abi, CalldataAddress, cli.parseArg, "numeric-zero", ["--args", AGENT, "--args=0"]),
    describeCandidate(abi, CalldataAddress, cli.parseArg, "json-array-empty-string", ["--args", AGENT, '--args=[""]']),
  ];

  for (const candidate of candidates) {
    const second = candidate.parserArgs[1];
    if (candidate.name !== "literal-quote-pair" && candidate.name !== "space" && candidate.name !== "json-array-empty-string") {
      if (second?.type !== "number" || second?.value !== 0) {
        throw new Error(`${candidate.name} no longer reproduces the pinned CLI coercion`);
      }
    }
  }

  const sdkArgs = buildRootMandateSdkArgs(CalldataAddress);
  const sdkObject = abi.calldata.makeCalldataObject(METHOD, sdkArgs, undefined);
  const sdkBytes = abi.calldata.encode(sdkObject);
  const sdkDecoded = abi.calldata.decode(sdkBytes);
  const sdkMap = sdkDecoded instanceof Map ? sdkDecoded : new Map(Object.entries(sdkDecoded));
  const decodedArgs = sdkMap.get("args");
  if (!Array.isArray(decodedArgs) || decodedArgs.length !== 2) throw new Error("SDK round-trip argument count is not 2");
  if (!(decodedArgs[0] instanceof CalldataAddress)) throw new Error("SDK round-trip arg0 is not Address");
  if (Buffer.from(decodedArgs[0].bytes).toString("hex") !== AGENT.slice(2)) throw new Error("SDK round-trip Address mismatch");
  if (typeof decodedArgs[1] !== "string" || decodedArgs[1] !== "") throw new Error("SDK round-trip did not preserve empty string");

  return {
    method: METHOD,
    cliSource: findStableCliSource(),
    cliBundle: cli.bundle,
    cliParserSourceVerified: true,
    cliExactEmptyStringSupported: false,
    candidates,
    sdk: {
      package: "genlayer-js",
      version: "1.1.8",
      args: [{type: "Address", value: AGENT}, ""],
      argumentCount: decodedArgs.length,
      arg0Type: "Address",
      arg0Value: AGENT,
      arg1Type: typeof decodedArgs[1],
      arg1Value: decodedArgs[1],
      arg1Utf8Length: new TextEncoder().encode(decodedArgs[1]).length,
      calldataString: abi.calldata.toString(sdkObject),
      encodedBytes: Array.from(sdkBytes),
      decodedString: abi.calldata.toString(sdkDecoded),
      emptyStringPreserved: true,
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const proof = await runQualificationCallDataRegression();
  console.log("CALLDATA_REGRESSION: passed (pinned CLI rejected; pinned SDK round-trip passed)");
  console.log(JSON.stringify(proof, (_key, value) => typeof value === "bigint" ? `${value}n` : value, 2));
}
