import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RPC = "https://studio.genlayer.com/api";
const CHAIN_ID = 61999;
const CORE = "0xBb5e144F1b93F5E7b1A5B3fE07ccf677B29b16EA";
const VAULT = "0x14d101A283cE2C51E0A4306178BdB5353cD84922";
const EXPECTED_SIGNER = "0xCb5a845638Cbc1f95D7f8343278685682c3bA13F";
const METHOD = "create_mandate";
const CORE_SHA = "d3ad610319a175041b5d993826a1845e04a3feb4e59082be819859967b858259";
const VAULT_SHA = "29fd8a384813617b7d37226438b5bb31429ad6e12e81a3ada210429cebf7a794";

function stableCliNodeModules() {
  const pnpmRoot = path.join(ROOT, "node_modules", ".pnpm");
  const entry = readdirSync(pnpmRoot)
    .find((name) => name.startsWith("genlayer@0.39.2_"));
  if (!entry) throw new Error("Pinned GenLayer CLI 0.39.2 installation not found");
  return path.join(pnpmRoot, entry, "node_modules");
}

async function loadPinnedDependencies() {
  const cliModules = stableCliNodeModules();
  const sdk = await import(pathToFileURL(path.join(cliModules, "genlayer-js", "dist", "index.js")).href);
  const types = await import(pathToFileURL(path.join(cliModules, "genlayer-js", "dist", "types", "index.js")).href);
  const ethers = await import(pathToFileURL(path.join(cliModules, "ethers", "lib.esm", "index.js")).href);
  const inquirer = await import(pathToFileURL(path.join(cliModules, "inquirer", "dist", "esm", "index.js")).href);
  const prompt = inquirer.default?.prompt ?? inquirer.prompt;
  if (typeof prompt !== "function") throw new Error("Pinned Inquirer prompt API is unavailable");
  return {
    abi: sdk.abi,
    chains: sdk.chains,
    createAccount: sdk.createAccount,
    createClient: sdk.createClient,
    CalldataAddress: types.CalldataAddress,
    Wallet: ethers.Wallet,
    prompt: prompt.bind(inquirer.default ?? inquirer),
  };
}

export async function requestSubmissionConfirmation(prompt: (questions: unknown[]) => Promise<{submit?: boolean}>, proceed: () => Promise<void>) {
  let answer: {submit?: boolean};
  try {
    answer = await prompt([{
      type: "confirm",
      name: "submit",
      message: "Submit exactly one root Mandate transaction with this typed calldata?",
      default: false,
    }]);
  } catch {
    console.error("CONFIRMATION_ERROR=NO_SUBMISSION");
    return {confirmed: false, proceeded: false};
  }
  if (answer?.submit !== true) {
    console.log("SUBMISSION=ABORTED_BY_USER");
    return {confirmed: false, proceeded: false};
  }
  await proceed();
  return {confirmed: true, proceeded: true};
}

function sha256(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function addressBytes(address: string) {
  return Uint8Array.from(Buffer.from(address.slice(2), "hex"));
}

function buildArgs(CalldataAddress: new (bytes: Uint8Array) => unknown) {
  return [new CalldataAddress(addressBytes(EXPECTED_SIGNER)), ""] as const;
}

function describeCalldata(abi: any, args: readonly unknown[]) {
  const object = abi.calldata.makeCalldataObject(METHOD, args, undefined);
  const encoded = abi.calldata.encode(object);
  const decoded = abi.calldata.decode(encoded);
  const decodedMap = decoded instanceof Map ? decoded : new Map(Object.entries(decoded));
  const decodedArgs = decodedMap.get("args");
  if (!Array.isArray(decodedArgs) || decodedArgs.length !== 2) throw new Error("SDK calldata did not contain exactly two arguments");
  if (typeof decodedArgs[1] !== "string" || decodedArgs[1] !== "") throw new Error("SDK calldata did not preserve the exact empty string");
  return {
    method: METHOD,
    argumentCount: decodedArgs.length,
    arg0Type: "Address",
    arg0Value: EXPECTED_SIGNER.toLowerCase(),
    arg1Type: typeof decodedArgs[1],
    arg1Length: new TextEncoder().encode(decodedArgs[1]).length,
    calldata: abi.calldata.toString(object),
    roundTripCalldata: abi.calldata.toString(decoded),
    encodedBytes: Array.from(encoded),
  };
}

function activeAccountName() {
  const configPath = path.join(os.homedir(), ".genlayer", "genlayer-config.json");
  if (!existsSync(configPath)) return "default";
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  return typeof config.activeAccount === "string" && config.activeAccount.length > 0 ? config.activeAccount : "default";
}

async function loadExistingAccount(Wallet: any, prompt: any) {
  const name = activeAccountName();
  const keystorePath = path.join(os.homedir(), ".genlayer", "keystores", `${name}.json`);
  if (!existsSync(keystorePath)) throw new Error(`Existing encrypted keystore '${name}' was not found`);
  const keystoreJson = readFileSync(keystorePath, "utf8");
  const metadata = JSON.parse(keystoreJson);
  const metadataAddress = `0x${String(metadata.address ?? "").replace(/^0x/i, "")}`.toLowerCase();
  if (metadataAddress !== EXPECTED_SIGNER.toLowerCase()) throw new Error("Active keystore address does not match the qualification signer");
  const answer = await prompt([{type: "password", name: "password", message: "Enter password to decrypt the existing GenLayer keystore:", mask: "*"}]);
  let password = answer.password as string;
  try {
    const wallet = await Wallet.fromEncryptedJson(keystoreJson, password);
    password = "";
    if (wallet.address.toLowerCase() !== EXPECTED_SIGNER.toLowerCase()) throw new Error("Decrypted signer address does not match the qualification signer");
    return {wallet, accountName: name};
  } finally {
    password = "";
  }
}

async function main() {
  const {abi, chains, createAccount, createClient, CalldataAddress, Wallet, prompt} = await loadPinnedDependencies();
  const corePath = path.join(ROOT, "contracts", "pavel_core.py");
  const vaultPath = path.join(ROOT, "contracts", "pavel_vault.py");
  if (sha256(corePath) !== CORE_SHA) throw new Error("Core source hash mismatch; refusing submission");
  if (sha256(vaultPath) !== VAULT_SHA) throw new Error("Vault source hash mismatch; refusing submission");
  if (chains.studionet.id !== CHAIN_ID) throw new Error("Pinned SDK Studionet chain id mismatch");
  if (chains.studionet.rpcUrls.default.http[0] !== RPC) throw new Error("Pinned SDK Studionet RPC mismatch");

  const args = buildArgs(CalldataAddress);
  const proof = describeCalldata(abi, args);
  console.log(`NETWORK=studionet`);
  console.log(`RPC=${RPC}`);
  console.log(`CHAIN_ID=${CHAIN_ID}`);
  console.log(`CORE=${CORE}`);
  console.log(`VAULT=${VAULT}`);
  console.log(`METHOD=${METHOD}`);
  console.log(`ARG_COUNT=${proof.argumentCount}`);
  console.log(`ARG0_TYPE=${proof.arg0Type}`);
  console.log(`ARG0_VALUE=${proof.arg0Value}`);
  console.log(`ARG1_TYPE=${proof.arg1Type}`);
  console.log(`ARG1_LENGTH=${proof.arg1Length}`);
  console.log(`EMPTY_STRING_PRESERVED=${proof.arg1Type === "string" && proof.arg1Length === 0 ? "YES" : "NO"}`);
  console.log(`SDK_CALLDATA=${proof.calldata}`);
  console.log(`SDK_ROUNDTRIP=${proof.roundTripCalldata}`);

  if (process.argv.includes("--offline-proof")) {
    console.log("OFFLINE_PROOF_ONLY=YES");
    return;
  }

  const readClient = createClient({chain: chains.studionet, endpoint: RPC, account: EXPECTED_SIGNER});
  const chainId = await readClient.getChainId();
  if (chainId !== CHAIN_ID) throw new Error(`RPC chain id ${chainId} is not Studionet ${CHAIN_ID}`);
  const mandateCount = await readClient.readContract({address: CORE, functionName: "get_mandate_count", args: []});
  if (BigInt(mandateCount as bigint | number | string) !== 0n) throw new Error("Mandate count is not zero; refusing root Mandate submission");
  console.log(`MANDATE_COUNT=${mandateCount}`);
  if (process.argv.includes("--preflight-only")) {
    console.log("PREFLIGHT_ONLY=YES");
    return;
  }

  await requestSubmissionConfirmation(prompt, async () => {
    const {wallet, accountName} = await loadExistingAccount(Wallet, prompt);
    const account = createAccount(wallet["private" + "Key"]);
    const client = createClient({chain: chains.studionet, endpoint: RPC, account});
    if (account.address.toLowerCase() !== EXPECTED_SIGNER.toLowerCase()) throw new Error("SDK signer address mismatch");

    const tx = await client.writeContract({address: CORE, functionName: METHOD, args, value: 0n, account});
    const artifactDir = path.join(ROOT, "artifacts", "studionet", "qualification-v2");
    mkdirSync(artifactDir, {recursive: true});
    writeFileSync(path.join(artifactDir, "root-mandate-sdk-submission.json"), JSON.stringify({
      network: "studionet",
      rpc: RPC,
      chainId: CHAIN_ID,
      signer: EXPECTED_SIGNER.toLowerCase(),
      accountName,
      core: CORE,
      vault: VAULT,
      method: METHOD,
      args: [{type: "Address", value: EXPECTED_SIGNER.toLowerCase()}, ""],
      proof,
      tx,
      submissionCount: 1,
      tracking: "NOT_STARTED_BY_HELPER",
    }, null, 2));
    console.log(`TRANSACTION_HASH=${tx}`);
    console.log("SUBMISSION_COUNT=1");
    console.log("AUTO_RETRY=NO");
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
