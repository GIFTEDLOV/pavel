import { expect, test, type Page } from "@playwright/test";

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
});
