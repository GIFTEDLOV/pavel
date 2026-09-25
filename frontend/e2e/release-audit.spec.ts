import { expect, test, type Page } from "@playwright/test";
import { abi } from "genlayer-js";

const walletAddress = "0x1111111111111111111111111111111111111111";
const chainId = "0xf22f"; // 61999

async function installSafeProvider(page: Page) {
  await page.addInitScript(({ address, chain }) => {
    let connected = false;
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const provider = {
      isPavelTestProvider: true,
      request: async ({ method }: { method: string }) => {
        if (method === "eth_accounts") return connected ? [address] : [];
        if (method === "eth_requestAccounts") {
          connected = true;
          return [address];
        }
        if (method === "eth_chainId") return chain;
        if (method === "wallet_switchEthereumChain") return null;
        if (method === "wallet_addEthereumChain") return null;
        if (method === "eth_estimateGas") return "0x5208";
        if (method === "eth_gasPrice") return "0x1";
        if (method === "eth_sendTransaction" || method === "eth_sendRawTransaction") {
          throw new Error("Browser release audit forbids chain writes");
        }
        return null;
      },
      on: (event: string, handler: (...args: unknown[]) => void) => {
        const handlers = listeners.get(event) ?? new Set();
        handlers.add(handler);
        listeners.set(event, handlers);
      },
      removeListener: (event: string, handler: (...args: unknown[]) => void) => {
        listeners.get(event)?.delete(handler);
      },
    };
    Object.assign(window, { ethereum: provider });
  }, { address: walletAddress, chain: chainId });
}

async function stubPublicRpc(page: Page) {
  await page.route("https://studio.genlayer.com/api", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { status: { code: 0 }, data: "" } }),
    });
  });
}

function encodedRead(value: unknown): string {
  const bytes = abi.calldata.encode(value as never);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function stubChallengeProtocolRpc(page: Page) {
  await page.unroute("https://studio.genlayer.com/api");
  await page.unroute("**/api**");
  const mandate = { mandate_id: "M-1", principal: walletAddress, authorized_agent: walletAddress, parent_mandate_id: "", title: "Fixture mandate", purpose: "Fixture purpose", constitution: "bounded", permitted_activity: "service", forbidden_activity: "fraud", maximum_single_transaction: "1000000000000000000", epoch_budget: "1000000000000000000", epoch_duration_seconds: "3600", total_budget: "1000000000000000000", valid_from: "1", expires_at: "9999999999", challenge_window_seconds: "3600", evidence_policy: "https", authority_constraints: "fixture.example", fulfillment_policy: "complete", recovery_policy: "alternate", definition_hash: "m".repeat(64), status: "SEALED" };
  const intent = { intent_id: "I-1", mandate_id: "M-1", agent: walletAddress, principal: walletAddress, counterparty: walletAddress, counterparty_identity_id: "CP-1", counterparty_authority_origin: "fixture.example", counterparty_identity_fingerprint: "c".repeat(64), recipient: walletAddress, amount: "100000000000000000", title: "Fixture intent", purpose: "Fixture purpose", deliverable: "Fixture deliverable", commercial_terms: "Fixture terms", fulfillment_criteria: "Fixture criteria", status: "DISPUTED", intent_fingerprint: "i".repeat(64), current_snapshot_id: "S-1", settlement_direction: "", challenge_deadline: "9999999999" };
  const accounting = { mandate_id: "M-1", deposited: "1000000000000000000", available: "0", reserved: "100000000000000000", release_pending: "0", refund_pending: "0", recovered: "0", committed: "100000000000000000", epoch_start: "1", epoch_spent: "100000000000000000", conserved: true };
  const authorization = { intent_id: "I-1", intent_fingerprint: intent.intent_fingerprint, mandate_id: "M-1", mandate_fingerprint: mandate.definition_hash, status: "AUTHORIZED", authorization_schema: "pavel-authorization-v2", authorization_decision: "AUTHORIZED", authorization_reason_code: "ALL_CHECKS_PASSED", failed_checks: [], principal: walletAddress, agent: walletAddress, recipient: walletAddress, counterparty: walletAddress, counterparty_identity_id: "CP-1", counterparty_identity_fingerprint: intent.counterparty_identity_fingerprint, counterparty_authority_origin: "fixture.example", amount: intent.amount, intent_expires_at: "9999999999", mandate_status: "SEALED", mandate_expires_at: "9999999999", maximum_single_transaction: mandate.maximum_single_transaction, epoch_budget: mandate.epoch_budget, epoch_duration_seconds: mandate.epoch_duration_seconds, total_budget: mandate.total_budget, allow_prior_reservations: false };
  const reservation = { intent_id: "I-1", mandate_id: "M-1", principal: walletAddress, agent: walletAddress, counterparty: walletAddress, recipient: walletAddress, amount: intent.amount, intent_fingerprint: intent.intent_fingerprint, status: "RESERVED", reserved_at: "1", settlement_id: "SETTLE:I-1", };
  const capture = (evidenceId: string, sequence: string, challengeId?: string) => ({ evidence_id: evidenceId, sequence, url: "https://fixture.example/evidence", transport_url: "https://fixture.example/evidence", status: 200, capture_class: "AUTHENTICATED", sha256: "a".repeat(64), byte_length: 4, content: "done", excerpt: "done", ...(challengeId ? { challenge_id: challengeId } : {}) });
  const snapshot = { snapshot_id: "S-1", intent_id: "I-1", mandate_id: "M-1", parent_snapshot_id: "", captured_at: "1", policy_version: "1", evidence_set_identity: "set-1", fingerprint: "s".repeat(64), captures: [capture("E-0", "0"), capture("E-1", "1")] };
  const challengeSnapshot = { snapshot_id: "S-2", intent_id: "I-1", mandate_id: "M-1", parent_snapshot_id: "S-1", captured_at: "2", policy_version: "1", evidence_set_identity: "set-challenge", fingerprint: "t".repeat(64), challenge_id: "D-1", captures: [capture("E-3", "0", "D-1")] };
  const evidence0 = { evidence_id: "E-0", mandate_id: "M-1", intent_id: "I-1", evidence_kind: "PRODUCT_SERVICE", origin_url: "https://fixture.example/evidence", expected_authority: "fixture.example", expected_hash: "a".repeat(64), committed_sha256: "a".repeat(64), committed_byte_length: "4", approved_recovery_authority: "fixture.example", sequence: "0", policy_fingerprint: intent.intent_fingerprint, identity_fingerprint: "e".repeat(64) };
  const evidence1 = { ...evidence0, evidence_id: "E-1", evidence_kind: "FULFILLMENT", sequence: "1" };
  const challengeEvidence1 = { ...evidence0, evidence_id: "E-3", evidence_kind: "CHALLENGE", challenge_id: "D-1", sequence: "0", policy_fingerprint: "d".repeat(64) };
  const challengeEvidence2 = { ...evidence0, evidence_id: "E-4", evidence_kind: "CHALLENGE", challenge_id: "D-2", sequence: "0", policy_fingerprint: "q".repeat(64) };
  const challenge1 = { challenge_id: "D-1", dispute_id: "D-1", intent_id: "I-1", challenger: "0x2222222222222222222222222222222222222222", reason: "Fixture qualifying challenge", opened_at: "1", deadline: "9999999999", original_fulfillment: "FULFILLED", original_snapshot_id: "S-1", base_intent_status: "FULFILLED", status: "QUALIFYING", last_error: "", evidence_ids: "E-3", evidence_ids_hash: "h".repeat(64), evidence_set_identity: "set-challenge", independent_snapshot_id: "S-2", adjudication: "", resolved_at: "", submission_fingerprint: "x".repeat(64), fingerprint: "y".repeat(64) };
  const challenge2 = { ...challenge1, challenge_id: "D-2", dispute_id: "D-2", challenger: walletAddress, reason: "Fixture pending challenge", status: "EVIDENCE_PENDING", evidence_ids: "E-4", independent_snapshot_id: "", evidence_set_identity: "", fingerprint: "z".repeat(64) };
  const settlement = { intent_id: "I-1", mandate_id: "M-1", status: "CHALLENGE_BLOCKED", direction: "", oldest_open_challenge: "D-1", ready_at: "1", challenge_deadline: "9999999999", fulfillment_deadline: "9999999999", fulfillment_result: {}, recipient: walletAddress, principal: walletAddress, amount: intent.amount, intent_fingerprint: intent.intent_fingerprint };
  const responses: unknown[] = [
    { deposited: "1000000000000000000", available: "0", reserved: "100000000000000000", conserved: true }, 1n, 1n,
    "M-1", "I-1", JSON.stringify(mandate), JSON.stringify(intent), JSON.stringify(accounting),
    JSON.stringify(snapshot), JSON.stringify(authorization), JSON.stringify(reservation), JSON.stringify(settlement), JSON.stringify(evidence0), JSON.stringify(evidence1), 2n,
    "D-1", "D-2", JSON.stringify(challenge1), JSON.stringify(challenge2), JSON.stringify(challengeEvidence1), "", "", "", "", "", "", "", JSON.stringify(challengeEvidence2), "", "", "", "", "", "", "", JSON.stringify(challengeSnapshot),
  ];
  let responseIndex = 0;
  await page.route("**/api**", async (route) => {
    const value = responses[responseIndex++] ?? "";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: responseIndex, result: { status: { code: 0 }, data: encodedRead(value) } }) });
  });
}

async function stubFulfillmentGateRpc(page: Page, authenticated: boolean) {
  await page.unroute("https://studio.genlayer.com/api");
  await page.unroute("**/api**");
  const address = walletAddress;
  const mandate = { mandate_id: "M-1", principal: address, authorized_agent: address, parent_mandate_id: "", title: "Fixture mandate", purpose: "Fixture purpose", constitution: "bounded", permitted_activity: "service", forbidden_activity: "fraud", maximum_single_transaction: "1000000000000000000", epoch_budget: "1000000000000000000", epoch_duration_seconds: "3600", total_budget: "1000000000000000000", valid_from: "1", expires_at: "9999999999", challenge_window_seconds: "3600", evidence_policy: "https", authority_constraints: "fixture.example", fulfillment_policy: "complete", recovery_policy: "alternate", definition_hash: "m".repeat(64), status: "SEALED" };
  const intent = { intent_id: "I-1", mandate_id: "M-1", agent: address, principal: address, counterparty: address, counterparty_identity_id: "CP-1", counterparty_authority_origin: "fixture.example", counterparty_identity_fingerprint: "c".repeat(64), recipient: address, amount: "100000000000000000", title: "Fixture fulfillment", purpose: "Fixture purpose", deliverable: "Fixture deliverable", commercial_terms: "Fixture terms", fulfillment_criteria: "Fixture criteria", status: "FULFILLMENT_PENDING", intent_fingerprint: "i".repeat(64), current_snapshot_id: "S-1", settlement_direction: "", challenge_deadline: "0" };
  const accounting = { mandate_id: "M-1", deposited: "1000000000000000000", available: "0", reserved: "100000000000000000", release_pending: "0", refund_pending: "0", recovered: "0", committed: "100000000000000000", epoch_start: "1", epoch_spent: "100000000000000000", conserved: true };
  const authorization = { intent_id: "I-1", intent_fingerprint: intent.intent_fingerprint, mandate_id: "M-1", mandate_fingerprint: mandate.definition_hash, status: "AUTHORIZED", authorization_schema: "pavel-authorization-v2", authorization_decision: "AUTHORIZED", authorization_reason_code: "ALL_CHECKS_PASSED", failed_checks: [], principal: address, agent: address, recipient: address, counterparty: address, counterparty_identity_id: "CP-1", counterparty_identity_fingerprint: intent.counterparty_identity_fingerprint, counterparty_authority_origin: "fixture.example", amount: intent.amount, intent_expires_at: "9999999999", mandate_status: "SEALED", mandate_expires_at: "9999999999", maximum_single_transaction: mandate.maximum_single_transaction, epoch_budget: mandate.epoch_budget, epoch_duration_seconds: mandate.epoch_duration_seconds, total_budget: mandate.total_budget, allow_prior_reservations: false };
  const reservation = { intent_id: "I-1", mandate_id: "M-1", principal: address, agent: address, counterparty: address, recipient: address, amount: intent.amount, intent_fingerprint: intent.intent_fingerprint, status: "RESERVED", reserved_at: "1", settlement_id: "SETTLE:I-1" };
  const evidence0 = { evidence_id: "E-0", mandate_id: "M-1", intent_id: "I-1", evidence_kind: "PRODUCT_SERVICE", origin_url: "https://fixture.example/evidence", expected_authority: "fixture.example", expected_hash: "a".repeat(64), committed_sha256: "a".repeat(64), committed_byte_length: "4", approved_recovery_authority: "fixture.example", sequence: "0", policy_fingerprint: intent.intent_fingerprint, identity_fingerprint: "e".repeat(64) };
  const evidence1 = { ...evidence0, evidence_id: "E-1", evidence_kind: "FULFILLMENT", sequence: "1" };
  const capture0 = { evidence_id: "E-0", sequence: "0", url: "https://fixture.example/evidence", transport_url: "https://fixture.example/evidence", status: 200, capture_class: "AUTHENTICATED", sha256: "a".repeat(64), byte_length: 4, content: "done", excerpt: "done" };
  const capture1 = { ...capture0, evidence_id: "E-1", sequence: "1" };
  const snapshot = { snapshot_id: "S-1", intent_id: "I-1", mandate_id: "M-1", parent_snapshot_id: "", captured_at: "1", policy_version: "1", evidence_set_identity: "set-1", fingerprint: "s".repeat(64), captures: authenticated ? [capture0, capture1] : [capture0] };
  const settlement = { intent_id: "I-1", mandate_id: "M-1", status: "FULFILLMENT_PENDING", direction: "", oldest_open_challenge: "", ready_at: "0", challenge_deadline: "0", fulfillment_deadline: "9999999999", fulfillment_result: {}, recipient: address, principal: address, amount: intent.amount, intent_fingerprint: intent.intent_fingerprint };
  const responses: unknown[] = [{ deposited: "1000000000000000000", available: "0", reserved: "100000000000000000", conserved: true }, 1n, 1n, "M-1", "I-1", JSON.stringify(mandate), JSON.stringify(intent), JSON.stringify(accounting), JSON.stringify(snapshot), JSON.stringify(authorization), JSON.stringify(reservation), JSON.stringify(settlement), JSON.stringify(evidence0), JSON.stringify(evidence1), 0n];
  let responseIndex = 0;
  await page.route("**/api**", async (route) => {
    const value = responses[responseIndex++] ?? "";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: responseIndex, result: { status: { code: 0 }, data: encodedRead(value) } }) });
  });
}

async function gotoSettled(page: Page, route: string) {
  const response = await page.goto(route, { waitUntil: "networkidle" });
  await page.waitForTimeout(100);
  return response;
}

async function installBrowserGuards(page: Page) {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  return browserErrors;
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page must not horizontally overflow").toBeLessThanOrEqual(1);
}

const desktopRoutes = [
  ["landing", "/"],
  ["app", "/app"],
  ["mandates", "/app/mandates"],
  ["intents", "/app/intents"],
  ["vault", "/app/vault"],
] as const;

test.describe("PAVEL browser release audit", () => {
  test.beforeEach(async ({ page }) => {
    await installSafeProvider(page);
    await stubPublicRpc(page);
  });

  test("desktop public routes render and capture audit screenshots", async ({ page }, testInfo) => {
    const browserErrors = await installBrowserGuards(page);
    for (const [name, route] of desktopRoutes) {
      const response = await gotoSettled(page, route);
      expect(response?.status(), `${route} should respond successfully`).toBe(200);
      await expect(page.locator("main, .landing-page").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`${name}-1440.png`), fullPage: true });
    }
    expect(browserErrors, "no uncaught browser or console errors").toEqual([]);
  });

  test("application routes and primary navigation are reachable without a wallet", async ({ page }) => {
    const browserErrors = await installBrowserGuards(page);
    const routes = ["/app", "/app/mandates", "/app/agents", "/app/intents", "/app/evidence", "/app/vault", "/app/disputes", "/app/activity", "/app/proof", "/app/security", "/integrate"];
    for (const route of routes) {
      const response = await gotoSettled(page, route);
      expect(response?.status(), `${route} should respond successfully`).toBe(200);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.getByRole("banner").getByRole("button", { name: "Connect wallet" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
    expect(browserErrors).toEqual([]);
  });

  test("mobile navigation opens, closes, and stays within the viewport", async ({ page }, testInfo) => {
    const browserErrors = await installBrowserGuards(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoSettled(page, "/app");
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.locator(".sidebar.sidebar-open")).toBeVisible();
    await page.getByRole("button", { name: "Close navigation" }).click();
    await expect(page.locator(".sidebar.sidebar-open")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("app-390.png"), fullPage: true });
    expect(browserErrors).toEqual([]);
  });

  test("wallet connect exposes a safe transaction review without broadcasting", async ({ page }) => {
    const browserErrors = await installBrowserGuards(page);
    await gotoSettled(page, "/app/agents");
    await page.getByRole("button", { name: /connect wallet/i }).click();
    await expect(page.getByRole("button", { name: /register this wallet/i })).toBeEnabled();
    await page.getByRole("button", { name: /register this wallet/i }).click();
    await expect(page.getByRole("dialog", { name: "Review transaction" })).toBeVisible();
    await expect(page.getByText("REVIEW BEFORE SIGNING")).toBeVisible();
    await expect(page.getByText("Approve in wallet")).toBeVisible();
    await page.getByRole("button", { name: "Cancel transaction review" }).click();
    await expect(page.getByRole("dialog", { name: "Review transaction" })).toHaveCount(0);
    expect(browserErrors).toEqual([]);
  });

  test("advanced details can be opened when present", async ({ page }) => {
    await gotoSettled(page, "/app/activity");
    const summary = page.getByText("Advanced details", { exact: true });
    if (await summary.count()) {
      await summary.first().click();
      await expect(page.locator(".json-block").first()).toBeVisible();
    }
  });

  test("challenge read model renders qualification, settlement blocking, and canonical evidence actions", async ({ page }) => {
    await stubChallengeProtocolRpc(page);
    await gotoSettled(page, "/app/disputes");
    await expect(page.getByText("Fixture qualifying challenge")).toBeVisible();
    await expect(page.getByText("QUALIFYING", { exact: true })).toBeVisible();
    await expect(page.getByText("CHALLENGE_BLOCKED", { exact: true })).toBeVisible();
    await expect(page.getByText("direction: empty", { exact: true })).toBeVisible();
    await expect(page.getByText("A submitted challenge alone does not block settlement.")).toBeVisible();
    await expect(page.getByText("EVIDENCE_PENDING", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stage challenge evidence" })).toBeVisible();
    await page.getByRole("button", { name: "Connect wallet" }).click();
    await expect(page.getByRole("button", { name: /Define CHALLENGE evidence/ })).toBeVisible();
  });

  test("fulfillment assessment is hidden until canonical sequence-one evidence is authenticated", async ({ page }) => {
    await stubFulfillmentGateRpc(page, false);
    await gotoSettled(page, "/app/intents/I-1");
    await expect(page.getByText("FULFILLMENT EVIDENCE DEFINED / NOT AUTHENTICATED", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Assess fulfillment" })).toHaveCount(0);

    await stubFulfillmentGateRpc(page, true);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByText("FULFILLMENT EVIDENCE AUTHENTICATED", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Assess fulfillment" })).toBeVisible();
  });
});
