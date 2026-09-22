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
  "core:configure_mandate:recovery": "0xf9801c9a80a2948ac08dfb30908660a285dee0aafdf90bc59dd69fec1eaca180",
  "core:seal_mandate:recovery": "0xe66187c19131a72cd21db6ec1410d130fb576f7a4206d21af817c5aa6b58aca2",
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
  const policyFields = ["title", "purpose", "constitution", "permitted_activity", "forbidden_activity", "maximum_single_transaction", "epoch_budget", "epoch_duration_seconds", "total_budget", "challenge_window_seconds", "evidence_policy", "authority_constraints", "fulfillment_policy", "recovery_policy", "allow_prior_reservations"];
  const policyConfiguration = Object.fromEntries(policyFields.map((field) => [field, mandate[field]]));
  const failedSealStateMutation = mandate.status === "DRAFT" && mandate.sealed_at === "" && mandate.definition_hash === "" ? "NONE_ROLLED_BACK" : "MUTATION_DETECTED";
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
       policyConfiguration,
       failedSealStateMutation,
       failedSealStateReadback: {mandateId: mandate.mandate_id, status: mandate.status, sealed: mandate.status === "SEALED", definitionHash: mandate.definition_hash ?? "", sealedAt: mandate.sealed_at ?? "", validFrom: mandate.valid_from, expiresAt: mandate.expires_at},
    },
    latestNonce: safe(latestNonce),
  };
  write("seal-failure-reconciliation.json", result);
  console.log(JSON.stringify({
    statuses: Object.fromEntries(Object.entries(transactions).map(([label, item]) => [label, {status: item.status, execution: item.execution, nonce: item.nonce}])),
     mandate: {count, status: mandate.status, validFrom: mandate.valid_from, expiresAt: mandate.expires_at, sealed: mandate.status === "SEALED", failedSealStateMutation: result.state.failedSealStateMutation, policyConfiguration: result.state.policyConfiguration},
    binding: {vaultCore, coreVault, normalized: result.state.bindingNormalized},
    latestNonce: safe(latestNonce),
  }, null, 2));
}
await main();
