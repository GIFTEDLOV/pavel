import {existsSync, readFileSync, mkdirSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {loadPinnedDependencies} from "./create-root-mandate.ts";
import {inspectResults, sameAddress} from "./run-v3.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ARTIFACT_DIR = path.join(ROOT, "artifacts", "studionet", "qualification-v4");
const RPC = "https://studio.genlayer.com/api";
const CHAIN_ID = 61999;
const SIGNER = "0xcb5a845638cbc1f95d7f8343278685682c3ba13f";
const CORE = "0x0a6762c46F664751ee5a20d2efB94b979FA8a830";
const VAULT = "0x3737D9cD645cc6e8036D6775A8264aAa6422f9df";
const TXS: Record<string, string> = {
  "deploy:core": "0x27cc8e1945dff3fd1af97c6e258c9a5c88d98b77cb03a0e71c1b2d47fa0013f1",
  "deploy:vault": "0x20998c5bae3b2f9cae21fd907d9bc085105b17f6b7aa1c392909abed7876c329",
  "vault:bind_core": "0xcb15ac6abb43d525f4d3199f1ba4c773d2e546f21c8688c9f9c494b142606dc0",
  "core:set_vault_address": "0x3c1792d09452dbbc7d32f79e0b0118bc5ad3d3e9980b7d78a81870fb910df9b8",
  "core:register_principal": "0x1f07bb37b4b36e901c09c8c2bfcf6b4580a56a6eb11d2cb90708e54155c6be9d",
  "core:register_agent": "0xf7e744a74cbb1d794a6f6b972fda78a62ebf3b33b222a3f6a3998c068181180e",
  "core:create_mandate": "0xbab6dc0f4a6a670521647bfc45eb0da9129cc5b60f43fdde25d091df49c923ea",
  "core:configure_mandate": "0x870e9cda0c35d4f873ff498bed2574b44a55409af305dffa54ba71fc1b848a3e",
  "core:seal_mandate": "0x601d191e982c33aa2fc9200eb5a7002f567d80267ea52dbf1f59c75ed01b0866",
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let nextAllowed = 0;
async function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const delay = Math.max(0, nextAllowed - Date.now());
  if (delay) await wait(delay);
  nextAllowed = Date.now() + 2500;
  return operation();
}
function safe(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, safe(v)]));
  return value;
}
function write(name: string, value: any) {
  mkdirSync(ARTIFACT_DIR, {recursive: true});
  writeFileSync(path.join(ARTIFACT_DIR, name), JSON.stringify(safe(value), null, 2) + "\n");
}
function decodedCalldata(abi: any, receipt: any) {
  const raw = receipt?.data?.calldata?.raw;
  if (!Array.isArray(raw)) return {supported: false, readable: receipt?.data?.calldata?.readable ?? ""};
  try {
    const decoded = abi.calldata.decode(Uint8Array.from(raw));
    return {supported: true, decoded: safe(decoded), readable: receipt?.data?.calldata?.readable ?? ""};
  } catch (error: any) {
    return {supported: false, error: String(error?.message ?? error), readable: receipt?.data?.calldata?.readable ?? ""};
  }
}
async function main() {
  const deps = await loadPinnedDependencies();
  const {abi, chains, createClient} = deps;
  const client = createClient({chain: chains.studionet, endpoint: RPC, account: SIGNER});
  if (await serialized(() => client.getChainId()) !== CHAIN_ID) throw new Error("not Studionet 61999");
  const transactions: Record<string, any> = {};
  for (const [label, hash] of Object.entries(TXS)) {
    const receipt = await serialized(() => client.getTransaction({hash}));
    const observation = inspectResults(receipt);
    transactions[label] = {
      tx: hash,
      status: receipt?.statusName ?? receipt?.status ?? "UNKNOWN",
      execution: observation.executionResult,
      executionResultSource: observation.executionResultSource,
      txExecutionResultName: receipt?.txExecutionResultName ?? receipt?.tx_execution_result_name ?? "UNAVAILABLE",
      consensusResult: observation.consensusResult,
      nonce: receipt?.nonce,
      sender: receipt?.from_address ?? receipt?.sender,
      recipient: receipt?.to_address ?? receipt?.recipient,
      decodedCalldata: decodedCalldata(abi, receipt),
      leaderReceipt: receipt?.consensus_data?.leader_receipt ?? receipt?.leader_receipt ?? [],
      receipt,
    };
  }
  const read = (address: string, functionName: string, args: any[] = []) => serialized(() => client.readContract({address, functionName, args, account: SIGNER}));
  const count = String(await read(CORE, "get_mandate_count"));
  const mandateText = String(await read(CORE, "get_mandate", ["M-1"]));
  const mandate = mandateText ? JSON.parse(mandateText) : {};
  const vaultCore = String(await read(VAULT, "get_core_address"));
  const coreVault = String(await read(CORE, "get_vault_address"));
  const historyLength = Number(await read(CORE, "get_history_length"));
  const history: any[] = [];
  for (let i = 0; i < historyLength; i += 1) history.push(JSON.parse(String(await read(CORE, "get_history_item", [BigInt(i)]))));
  const accounting = JSON.parse(String(await read(VAULT, "get_global_accounting")));
  const latestNonce = await serialized(() => client.getCurrentNonce({address: SIGNER}));
  const result = {
    network: "studionet", rpc: RPC, chainId: CHAIN_ID, generatedAt: new Date().toISOString(),
    addresses: {core: CORE, vault: VAULT},
    transactions,
    state: {
      mandateCount: count,
      mandateId: mandate.mandate_id ?? "M-1",
      mandate,
      mandateSealed: mandate.status === "SEALED",
      vaultCore,
      coreVault,
      bindingNormalized: sameAddress(vaultCore, CORE) && sameAddress(coreVault, VAULT),
      history,
      globalAccounting: accounting,
      failedSealStateMutation: mandate.status === "DRAFT" && mandate.definition_hash === "" ? "NONE_ROLLED_BACK" : "UNPROVEN",
    },
    latestNonce: safe(latestNonce),
  };
  write("seal-failure-reconciliation.json", result);
  console.log(JSON.stringify({
    statuses: Object.fromEntries(Object.entries(transactions).map(([label, item]) => [label, {status: item.status, execution: item.execution, nonce: item.nonce}])),
    mandate: {count, status: mandate.status, validFrom: mandate.valid_from, expiresAt: mandate.expires_at, sealed: mandate.status === "SEALED", failedSealStateMutation: result.state.failedSealStateMutation},
    binding: {vaultCore, coreVault, normalized: result.state.bindingNormalized},
    latestNonce: safe(latestNonce),
  }, null, 2));
}
await main();
