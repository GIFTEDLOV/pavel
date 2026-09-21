import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  findExpectedKeystore,
  loadExistingAccount,
  loadPinnedDependencies,
} from "./create-root-mandate.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RPC = "https://studio.genlayer.com/api";
const CHAIN_ID = 61999;
const CORE = "0xBb5e144F1b93F5E7b1A5B3fE07ccf677B29b16EA";
const VAULT = "0x14d101A283cE2C51E0A4306178BdB5353cD84922";
const EXPECTED_SIGNER = "0xcb5a845638cbc1f95d7f8343278685682c3ba13f";
const CORE_SHA = "d3ad610319a175041b5d993826a1845e04a3feb4e59082be819859967b858259";
const VAULT_SHA = "29fd8a384813617b7d37226438b5bb31429ad6e12e81a3ada210429cebf7a794";
const ARTIFACT_DIR = path.join(ROOT, "artifacts", "studionet", "qualification-v2");
const FIXTURE_PATH = path.join(ARTIFACT_DIR, "qualification-fixture.json");
const POLL_MS = 5000;
const MAX_POLLS = 240;

type Fixture = Record<string, any>;

function jsonSafe(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    const output: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) output[key] = jsonSafe(item);
    return output;
  }
  return value;
}

function writeArtifact(name: string, value: any) {
  mkdirSync(ARTIFACT_DIR, {recursive: true});
  writeFileSync(path.join(ARTIFACT_DIR, name), JSON.stringify(jsonSafe(value), null, 2) + "\n");
}

function readFixture(): Fixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

function sha256(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function addressBytes(address: string) {
  return Uint8Array.from(Buffer.from(address.slice(2), "hex"));
}

function address(CalldataAddress: new (bytes: Uint8Array) => unknown, value: string) {
  return new CalldataAddress(addressBytes(value));
}

function asText(value: any): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function asRecord(value: any): Record<string, any> {
  if (typeof value === "string") return value === "" ? {} : JSON.parse(value);
  if (value && typeof value === "object") return value as Record<string, any>;
  return {};
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function ensureFixtureDefaults(fixture: Fixture) {
  return {
    ...fixture,
    title: fixture.title ?? "Qualification digital deliverable",
    constitution: fixture.constitution ?? "The agent may act only within this sealed constitution; deterministic limits and source authorities are binding.",
    evidencePolicy: fixture.evidencePolicy ?? "Authenticated HTTPS evidence from docs.genlayer.com is required.",
    authorityConstraints: fixture.authorityConstraints ?? fixture.authority,
    fulfillmentPolicy: fixture.fulfillmentPolicy ?? "The named qualification digital deliverable must be materially delivered and evidenced.",
    recoveryPolicy: fixture.recoveryPolicy ?? "Only same-byte authenticated recovery through docs.genlayer.com is permitted.",
    evidenceUrl: fixture.evidenceUrl ?? "https://docs.genlayer.com/robots.txt",
    deliverable: fixture.deliverable ?? "The official GenLayer documentation authority artifact at the registered authority.",
    commercialTerms: fixture.commercialTerms ?? "One qualification-only delivery; no recurring payment; value is one minimal GEN unit.",
    fulfillmentCriteria: fixture.fulfillmentCriteria ?? "The exact registered-authority artifact is available and corresponds to the frozen Intent.",
  };
}

function appendTransaction(entry: Record<string, any>) {
  const transactionPath = path.join(ARTIFACT_DIR, "transactions.json");
  let document: any = {network: "studionet", rpc: RPC, chainId: CHAIN_ID, transactions: []};
  if (existsSync(transactionPath)) document = JSON.parse(readFileSync(transactionPath, "utf8"));
  document.transactions ??= [];
  const existingIndex = document.transactions.findIndex((item: any) => item.tx === entry.tx);
  if (existingIndex === -1) document.transactions.push(jsonSafe(entry));
  else document.transactions[existingIndex] = {...document.transactions[existingIndex], ...jsonSafe(entry)};
  writeArtifact("transactions.json", document);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function reconcile(client: any, tx: string, account: any): Promise<any> {
  let finalizationTx: string | undefined;
  for (let attempt = 1; attempt <= MAX_POLLS; attempt += 1) {
    const receipt = await client.getTransaction({hash: tx});
    writeArtifact(`tx-${tx.slice(2, 14)}.json`, {tx, attempt, receipt});
    const status = receipt.statusName ?? String(receipt.status ?? "");
    if (status === "FINALIZED") {
      const execution = receipt.txExecutionResultName ?? "UNKNOWN";
      if (execution !== "FINISHED_WITH_RETURN") {
        throw new Error(`Transaction ${tx} finalized with execution ${execution}`);
      }
      return {receipt, finalizationTx};
    }
    if (status === "CANCELED" || status === "UNDETERMINED" || status === "VALIDATORS_TIMEOUT" || status === "LEADER_TIMEOUT") {
      throw new Error(`Transaction ${tx} reached terminal non-success status ${status}`);
    }
    if (status === "READY_TO_FINALIZE" && !finalizationTx) {
      finalizationTx = await client.finalizeTransaction({account, txId: tx});
      appendTransaction({kind: "finalize:" + tx, tx: finalizationTx, status: "SUBMITTED", execution: "PENDING"});
    }
    await sleep(POLL_MS);
  }
  throw new Error(`Timed out reconciling ${tx}; no replacement was submitted`);
}

async function read(client: any, addressValue: string, functionName: string, args: any[] = []) {
  return client.readContract({address: addressValue, functionName, args, account: EXPECTED_SIGNER});
}

async function writeStep(
  client: any,
  account: any,
  label: string,
  functionName: string,
  args: any[],
  argumentSummary: any[],
  precondition: () => Promise<void>,
  readback: () => Promise<any>,
  value = 0n,
) {
  await precondition();
  const tx = String(await client.writeContract({address: label.startsWith("vault:") ? VAULT : CORE, functionName, args, value, account}));
  const entry: Record<string, any> = {kind: label, tx, method: functionName, args: argumentSummary, value: value.toString(), broadcastedAt: new Date().toISOString(), status: "SUBMITTED", execution: "PENDING"};
  appendTransaction(entry);
  console.log(`TX_SUBMITTED=${label} ${tx}`);
  const result = await reconcile(client, tx, account);
  entry.status = result.receipt.statusName;
  entry.execution = result.receipt.txExecutionResultName;
  entry.resultName = result.receipt.resultName;
  entry.receipt = result.receipt;
  if (result.finalizationTx) entry.finalizationTx = result.finalizationTx;
  const state = await readback();
  entry.readback = state;
  appendTransaction(entry);
  writeArtifact("last-lifecycle-step.json", entry);
  return {tx, receipt: result.receipt, readback: state};
}

async function simulateUnassessedReservation(client: any, account: any, intentId: string) {
  try {
    const value = await client.simulateWriteContract({address: VAULT, functionName: "reserve", args: [intentId], account});
    const proof = {intentId, simulation: "UNEXPECTED_SUCCESS", value: jsonSafe(value)};
    writeArtifact("unassessed-reservation-proof.json", proof);
    return proof;
  } catch (error: any) {
    const proof = {intentId, simulation: "DETERMINISTIC_REJECTION", error: String(error?.message ?? error), noTransactionSubmitted: true};
    writeArtifact("unassessed-reservation-proof.json", proof);
    return proof;
  }
}

async function main() {
  const deps = await loadPinnedDependencies();
  const {abi, chains, createAccount, createClient, CalldataAddress, Wallet, prompt} = deps;
  const fixture = ensureFixtureDefaults(readFixture());
  if (sha256(path.join(ROOT, "contracts", "pavel_core.py")) !== CORE_SHA) throw new Error("Core source hash mismatch");
  if (sha256(path.join(ROOT, "contracts", "pavel_vault.py")) !== VAULT_SHA) throw new Error("Vault source hash mismatch");
  if (chains.studionet.id !== CHAIN_ID || chains.studionet.rpcUrls.default.http[0] !== RPC) throw new Error("Pinned SDK Studionet configuration mismatch");
  if (nowSeconds() >= Number(fixture.expiresAt)) throw new Error("Qualification fixture has expired");

  const readClient = createClient({chain: chains.studionet, endpoint: RPC, account: EXPECTED_SIGNER});
  if (await readClient.getChainId() !== CHAIN_ID) throw new Error("RPC is not Studionet 61999");
  const [owner, vaultAddress, mandateCount, intentCount, c1, globalAccounting] = await Promise.all([
    read(readClient, CORE, "get_owner"),
    read(readClient, CORE, "get_vault_address"),
    read(readClient, CORE, "get_mandate_count"),
    read(readClient, CORE, "get_intent_count"),
    read(readClient, CORE, "get_counterparty", ["C-1"]),
    read(readClient, VAULT, "get_global_accounting"),
  ]);
  if (asText(owner).toLowerCase() !== EXPECTED_SIGNER) throw new Error("Core owner does not match qualification signer");
  if (asText(vaultAddress).toLowerCase() !== VAULT.toLowerCase()) throw new Error("Core/Vault binding readback mismatch");
  const selectedKeystore = findExpectedKeystore();
  const plan = {network: "studionet", rpc: RPC, chainId: CHAIN_ID, core: CORE, vault: VAULT, signer: EXPECTED_SIGNER, selectedKeystore: {name: selectedKeystore.name, address: selectedKeystore.address}, mandateCount: asText(mandateCount), intentCount: asText(intentCount), counterpartyC1Present: asText(c1) !== "", globalAccounting: asRecord(globalAccounting), sourceHashes: {core: CORE_SHA, vault: VAULT_SHA}};
  writeArtifact("qualification-run-plan.json", plan);
  console.log(JSON.stringify({QUALIFICATION_PLAN: plan}, null, 2));
  const confirmation = await prompt([{type: "confirm", name: "begin", message: "Begin the complete qualification-v2 run and permit sequential signed writes?", default: false}]);
  if (confirmation?.begin !== true) {
    console.log("QUALIFICATION_RUN=ABORTED_BY_USER");
    return;
  }

  writeArtifact("qualification-run-status.json", {status: "AWAITING_SECURE_KEYSTORE_PASSWORD", selectedKeystore: {name: selectedKeystore.name, address: selectedKeystore.address}, noTransactionSubmitted: true});
  const loaded = await loadExistingAccount(Wallet, prompt);
  let wallet: any = loaded.wallet;
  let signingSecret = wallet["private" + "Key"];
  const account = createAccount(signingSecret);
  if (account.address.toLowerCase() !== EXPECTED_SIGNER) throw new Error("Decrypted signer does not match expected qualification signer");
  writeArtifact("qualification-run-status.json", {status: "ACTIVE_IN_MEMORY", selectedKeystore: {name: selectedKeystore.name, address: selectedKeystore.address}, noTransactionSubmitted: true});
  const client = createClient({chain: chains.studionet, endpoint: RPC, account});
  let mandateId = "M-1";
  let mandate = asRecord(await read(client, CORE, "get_mandate", [mandateId]));

  try {
    if (Object.keys(mandate).length === 0) {
      await writeStep(client, account, "core:create_mandate", "create_mandate", [address(CalldataAddress, EXPECTED_SIGNER), ""], [{type: "Address", value: EXPECTED_SIGNER}, {type: "string", value: "", utf8Length: 0}], async () => {
        const count = await read(client, CORE, "get_mandate_count");
        if (BigInt(asText(count)) !== 0n) throw new Error("Root Mandate precondition changed; count is not zero");
      }, async () => read(client, CORE, "get_mandate", [mandateId]));
      mandate = asRecord(await read(client, CORE, "get_mandate", [mandateId]));
    }
    if (Object.keys(mandate).length === 0) throw new Error("M-1 was not created");
    if (mandate.status === "DRAFT" && (mandate.title ?? "") === "") {
      const configureArgs = [mandateId, fixture.title, fixture.purpose, fixture.constitution, fixture.permittedActivity, fixture.forbiddenActivity, BigInt(fixture.maximumSingleTransaction), BigInt(fixture.epochBudget), BigInt(fixture.epochDurationSeconds), BigInt(fixture.totalBudget), BigInt(fixture.validFrom), BigInt(fixture.expiresAt), BigInt(fixture.challengeWindowSeconds), fixture.evidencePolicy, fixture.authorityConstraints, fixture.fulfillmentPolicy, fixture.recoveryPolicy, false];
      await writeStep(client, account, "core:configure_mandate", "configure_mandate", configureArgs, [{type: "string", value: mandateId}, {type: "policy", value: "qualification-fixture"}], async () => {
        const current = asRecord(await read(client, CORE, "get_mandate", [mandateId]));
        if (current.status !== "DRAFT") throw new Error("Mandate is not configurable");
      }, async () => read(client, CORE, "get_mandate", [mandateId]));
      mandate = asRecord(await read(client, CORE, "get_mandate", [mandateId]));
    }
    if (mandate.status === "DRAFT") {
      await writeStep(client, account, "core:seal_mandate", "seal_mandate", [mandateId], [{type: "string", value: mandateId}], async () => {
        const current = asRecord(await read(client, CORE, "get_mandate", [mandateId]));
        if (current.status !== "DRAFT") throw new Error("Mandate seal precondition changed");
      }, async () => read(client, CORE, "get_mandate", [mandateId]));
      mandate = asRecord(await read(client, CORE, "get_mandate", [mandateId]));
    }
    if (mandate.status !== "SEALED") throw new Error(`M-1 did not seal; status=${mandate.status}`);

    let counterparty = asRecord(await read(client, CORE, "get_counterparty", ["C-1"]));
    if (Object.keys(counterparty).length === 0) {
      await writeStep(client, account, "core:register_counterparty", "register_counterparty", [address(CalldataAddress, EXPECTED_SIGNER), fixture.counterpartyLabel, fixture.authority], [{type: "Address", value: EXPECTED_SIGNER}, {type: "string", value: fixture.counterpartyLabel}, {type: "string", value: fixture.authority}], async () => {
        if (asText(await read(client, CORE, "get_counterparty", ["C-1"])) !== "") throw new Error("C-1 already exists unexpectedly");
      }, async () => read(client, CORE, "get_counterparty", ["C-1"]));
      counterparty = asRecord(await read(client, CORE, "get_counterparty", ["C-1"]));
    }
    if (counterparty.bound_wallet?.toLowerCase() !== EXPECTED_SIGNER || counterparty.authority_origin !== fixture.authority) throw new Error("Counterparty identity readback mismatch");

    const beforeAccounting = asRecord(await read(client, VAULT, "get_accounting", [mandateId]));
    if (BigInt(beforeAccounting.deposited ?? "0") < 1n) {
      await writeStep(client, account, "vault:deposit", "deposit", [mandateId], [{type: "string", value: mandateId}], async () => {
        const state = asRecord(await read(client, VAULT, "get_accounting", [mandateId]));
        if (BigInt(state.deposited ?? "0") !== BigInt(beforeAccounting.deposited ?? "0")) throw new Error("Deposit precondition changed");
      }, async () => read(client, VAULT, "get_accounting", [mandateId]), 1n);
    }

    let intentId = "I-1";
    let intent = asRecord(await read(client, CORE, "get_intent", [intentId]));
    const intentExpiresAt = Math.min(Number(fixture.expiresAt), nowSeconds() + 3600);
    if (Object.keys(intent).length === 0) {
      const intentArgs = [mandateId, "C-1", address(CalldataAddress, EXPECTED_SIGNER), 1n, "Qualification purchase", fixture.purpose, fixture.deliverable, fixture.commercialTerms, fixture.fulfillmentCriteria, BigInt(intentExpiresAt)];
      await writeStep(client, account, "core:create_intent", "create_intent", intentArgs, [{type: "string", value: mandateId}, {type: "string", value: "C-1"}, {type: "Address", value: EXPECTED_SIGNER}, {type: "u256", value: "1"}], async () => {
        if (asText(await read(client, CORE, "get_intent", [intentId])) !== "") throw new Error("I-1 already exists unexpectedly");
      }, async () => read(client, CORE, "get_intent", [intentId]));
      intent = asRecord(await read(client, CORE, "get_intent", [intentId]));
    }
    if (intent.status === "DRAFT") {
      await writeStep(client, account, "core:submit_intent", "submit_intent", [intentId], [{type: "string", value: intentId}], async () => {
        const current = asRecord(await read(client, CORE, "get_intent", [intentId]));
        if (current.status !== "DRAFT") throw new Error("I-1 submission precondition changed");
      }, async () => read(client, CORE, "get_intent", [intentId]));
      intent = asRecord(await read(client, CORE, "get_intent", [intentId]));
    }

    if (["SUBMITTED", "EVIDENCE_RETRY_REQUIRED", "EVIDENCE_RECOVERY_REQUIRED", "EVIDENCE_REPAIR_REQUIRED"].includes(intent.status) && asText(await read(client, CORE, "get_evidence", [intentId, 0n])) === "") {
      await writeStep(client, account, "core:define_evidence:authorization", "define_evidence", [intentId, "PRODUCT_SERVICE", fixture.evidenceUrl, fixture.authority, "", 0n, fixture.authority, 0n], [{type: "evidence", kind: "PRODUCT_SERVICE", url: fixture.evidenceUrl, authority: fixture.authority}], async () => {}, async () => read(client, CORE, "get_evidence", [intentId, 0n]));
    }
    intent = asRecord(await read(client, CORE, "get_intent", [intentId]));
    if (["SUBMITTED", "EVIDENCE_RETRY_REQUIRED", "EVIDENCE_RECOVERY_REQUIRED", "EVIDENCE_REPAIR_REQUIRED"].includes(intent.status)) {
      await writeStep(client, account, "core:stage_evidence:authorization", "stage_evidence", [intentId], [{type: "string", value: intentId}], async () => {}, async () => read(client, CORE, "get_intent", [intentId]));
      intent = asRecord(await read(client, CORE, "get_intent", [intentId]));
    }
    if (intent.status === "EVIDENCE_READY") {
      await writeStep(client, account, "core:authorize_intent", "authorize_intent", [intentId], [{type: "string", value: intentId}], async () => {}, async () => read(client, CORE, "get_intent", [intentId]));
      intent = asRecord(await read(client, CORE, "get_intent", [intentId]));
    }
    if (intent.status !== "AUTHORIZED") throw new Error(`Positive Intent did not authorize; status=${intent.status} error=${intent.last_error ?? ""}`);

    let reservation = asText(await read(client, VAULT, "get_reservation", [intentId]));
    if (reservation === "") {
      await writeStep(client, account, "vault:reserve", "reserve", [intentId], [{type: "string", value: intentId}], async () => {
        const auth = asRecord(await read(client, CORE, "get_authorization_for_vault", [intentId]));
        if (auth.authorization_decision !== "AUTHORIZED") throw new Error("Vault reservation precondition is not authorized");
      }, async () => read(client, VAULT, "get_reservation", [intentId]));
      reservation = asText(await read(client, VAULT, "get_reservation", [intentId]));
    }

    let intent2Id = "I-2";
    let intent2 = asRecord(await read(client, CORE, "get_intent", [intent2Id]));
    if (Object.keys(intent2).length === 0) {
      await writeStep(client, account, "core:create_intent:unassessed", "create_intent", [mandateId, "C-1", address(CalldataAddress, EXPECTED_SIGNER), 1n, "Qualification unassessed proof", fixture.purpose, fixture.deliverable, fixture.commercialTerms, fixture.fulfillmentCriteria, BigInt(intentExpiresAt)], [{type: "intent", id: intent2Id, state: "DRAFT"}], async () => {}, async () => read(client, CORE, "get_intent", [intent2Id]));
      intent2 = asRecord(await read(client, CORE, "get_intent", [intent2Id]));
    }
    if (intent2.status === "DRAFT") {
      await writeStep(client, account, "core:submit_intent:unassessed", "submit_intent", [intent2Id], [{type: "string", value: intent2Id}], async () => {}, async () => read(client, CORE, "get_intent", [intent2Id]));
      intent2 = asRecord(await read(client, CORE, "get_intent", [intent2Id]));
    }
    const unassessedProof = await simulateUnassessedReservation(client, account, intent2Id);

    intent = asRecord(await read(client, CORE, "get_intent", [intentId]));
    if (intent.status === "AUTHORIZED") {
      await writeStep(client, account, "core:start_fulfillment", "start_fulfillment", [intentId], [{type: "string", value: intentId}], async () => {
        const currentReservation = asRecord(await read(client, VAULT, "get_reservation", [intentId]));
        if (currentReservation.status !== "RESERVED") throw new Error("Fulfillment requires a live reservation");
      }, async () => read(client, CORE, "get_intent", [intentId]));
      intent = asRecord(await read(client, CORE, "get_intent", [intentId]));
    }
    if (intent.status === "FULFILLMENT_PENDING" && asText(await read(client, CORE, "get_evidence", [intentId, 1n])) === "") {
      await writeStep(client, account, "core:define_evidence:fulfillment", "define_evidence", [intentId, "FULFILLMENT", fixture.evidenceUrl, fixture.authority, "", 0n, fixture.authority, 1n], [{type: "evidence", kind: "FULFILLMENT", url: fixture.evidenceUrl, authority: fixture.authority}], async () => {}, async () => read(client, CORE, "get_evidence", [intentId, 1n]));
    }
    if (intent.status === "FULFILLMENT_PENDING") {
      await writeStep(client, account, "core:stage_evidence:fulfillment", "stage_evidence", [intentId], [{type: "string", value: intentId}], async () => {}, async () => read(client, CORE, "get_intent", [intentId]));
      await writeStep(client, account, "core:assess_fulfillment", "assess_fulfillment", [intentId], [{type: "string", value: intentId}], async () => {}, async () => read(client, CORE, "get_intent", [intentId]));
      intent = asRecord(await read(client, CORE, "get_intent", [intentId]));
    }
    const challengeStatus = {live: "BLOCKED_BY_SECOND_SIGNER", note: "No genuinely distinct controlled signer was available; no third-party identity was fabricated."};
    writeArtifact("third-party-challenge-live.json", challengeStatus);
    if (intent.status === "FULFILLED" && intent.settlement_direction === "RELEASE_TO_COUNTERPARTY") {
      let settlement = asRecord(await read(client, CORE, "get_settlement_instruction", [intentId]));
      while (settlement.ready_at && BigInt(settlement.ready_at) > BigInt(nowSeconds())) {
        console.log(`WAITING_FOR_CHALLENGE_WINDOW=${settlement.ready_at}`);
        await sleep(POLL_MS);
        settlement = asRecord(await read(client, CORE, "get_settlement_instruction", [intentId]));
      }
      const currentReservation = asRecord(await read(client, VAULT, "get_reservation", [intentId]));
      let settlementResult: {tx: string} | undefined;
      if (currentReservation.status === "RESERVED") {
        settlementResult = await writeStep(client, account, "vault:request_release", "request_release", [intentId], [{type: "string", value: intentId}], async () => {
          const instruction = asRecord(await read(client, CORE, "get_settlement_instruction", [intentId]));
          if (instruction.direction !== "RELEASE_TO_COUNTERPARTY") throw new Error("Release direction is not authorized");
          if (BigInt(instruction.ready_at) > BigInt(nowSeconds())) throw new Error("Settlement challenge window is still open");
        }, async () => read(client, VAULT, "get_reservation", [intentId]));
      }
      let triggered: any[] = [];
      if (settlementResult) {
        try { triggered = await client.getTriggeredTransactionIds({hash: settlementResult.tx}); } catch { triggered = []; }
      }
      writeArtifact("external-message-observation.json", {intentId, settlementTx: settlementResult?.tx ?? null, triggeredTransactionIds: triggered, observation: "Parent settlement is recorded; child observation depends on Studionet exposure."});
    } else {
      writeArtifact("settlement-blocked.json", {intentId, status: intent.status, direction: intent.settlement_direction ?? "", reason: "Fulfillment did not produce a releasable result."});
    }

    const finalAccounting = {global: await read(client, VAULT, "get_global_accounting"), mandate: await read(client, VAULT, "get_accounting", [mandateId]), reservation: await read(client, VAULT, "get_reservation", [intentId]), intent: await read(client, CORE, "get_intent", [intentId]), unassessed: await read(client, CORE, "get_intent", [intent2Id]), unassessedProof};
    writeArtifact("qualification-final-readbacks.json", finalAccounting);
    writeArtifact("qualification-run-summary.json", {status: "COMPLETED_LIVE_FLOW", mandateId, intentId, unassessedIntentId: intent2Id, challengeStatus, finalAccounting});
    console.log("QUALIFICATION_RUN=COMPLETED_LIVE_FLOW");
  } finally {
    signingSecret = "";
    wallet = null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`QUALIFICATION_RUN=STOPPED ${String(error?.message ?? error)}`);
    writeArtifact("qualification-run-summary.json", {status: "STOPPED", error: String(error?.message ?? error)});
    process.exitCode = 1;
  });
}
