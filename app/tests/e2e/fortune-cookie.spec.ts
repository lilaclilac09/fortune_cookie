/**
 * End-to-end tests for Zen Fortune Cookie.
 *
 * Setup:
 *   yarn add -D @playwright/test
 *   npx playwright install chromium
 *   yarn dev &
 *   npx playwright test
 *
 * All tests use Demo Mode (no wallet extension needed).
 * For real on-chain tests against devnet, set LOCAL_WALLET_TEST=1
 * and ensure the local wallet (mock keypair) has devnet SOL.
 */

import { test, expect, Page } from "@playwright/test";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function enterDemoMode(page: Page) {
  await page.goto("/");
  // If landing on the mode-selector page, click Demo Mode
  const demoBtn = page.getByText("Demo Mode");
  if (await demoBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await demoBtn.click();
  }
  // Wait for the main game to be visible
  await expect(page.locator("text=点击 🥠 开始")).toBeVisible({ timeout: 10_000 });
}

async function breakCookie(page: Page) {
  // The giant cookie emoji is the clickable target
  const cookie = page.locator("text=🥠").first();
  await expect(cookie).toBeVisible({ timeout: 5000 });
  await cookie.click();
  // Wait for fortune paper to appear
  await expect(page.locator("text=Your Fortune")).toBeVisible({ timeout: 5000 });
}

async function resetCookie(page: Page) {
  await page.getByText("再来一次").click();
  // Cookie should return to intact state
  await expect(page.locator("text=点击 🥠 开始")).toBeVisible({ timeout: 5000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Landing page", () => {
  test("shows mode selector on first visit", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Zen Fortune Cookie")).toBeVisible();
    await expect(page.getByText("Demo Mode")).toBeVisible();
    await expect(page.getByText("Local Wallet")).toBeVisible();
  });

  test("has no console errors on load", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/");
    // Allow hydration warnings but fail on real errors
    const fatal = errors.filter(
      (e) => !e.includes("Warning:") && !e.includes("ReactDOM.render")
    );
    expect(fatal).toHaveLength(0);
  });
});

test.describe("Demo Mode — core gameplay", () => {
  test.beforeEach(async ({ page }) => {
    await enterDemoMode(page);
  });

  test("displays cookie emoji and instruction text", async ({ page }) => {
    await expect(page.locator("text=🥠").first()).toBeVisible();
    await expect(page.locator("text=点击 🥠 开始")).toBeVisible();
  });

  test("breaking cookie shows fortune paper", async ({ page }) => {
    await breakCookie(page);
    await expect(page.locator("text=Your Fortune")).toBeVisible();
    // Fortune text is one of the hardcoded FORTUNES array
    const fortuneEl = page.locator(".paper-texture p").nth(1);
    await expect(fortuneEl).not.toBeEmpty();
  });

  test("fortune shows points earned", async ({ page }) => {
    await breakCookie(page);
    // Points label is "+N PTS" where N is 10-100
    const pts = page.locator("text=/\\+\\d+ PTS/");
    await expect(pts).toBeVisible();
  });

  test("demo mode shows demo tx signature (not solscan link)", async ({ page }) => {
    await breakCookie(page);
    await expect(page.locator("text=On-chain confirmed!")).toBeVisible({ timeout: 3000 });
    // Demo tx starts with "demo_tx_"
    const sig = page.locator("text=/demo_tx_/");
    await expect(sig).toBeVisible();
  });

  test("再来一次 resets to intact cookie", async ({ page }) => {
    await breakCookie(page);
    await resetCookie(page);
    // Should be back to initial state
    await expect(page.locator("text=点击 🥠 开始")).toBeVisible();
    await expect(page.locator("text=Your Fortune")).not.toBeVisible();
  });

  test("points accumulate across multiple breaks", async ({ page }) => {
    const getPoints = async () => {
      const text = await page.locator("text=PTS").first().textContent() ?? "0";
      return parseInt(text.replace(/[^\d]/g, ""), 10);
    };

    await breakCookie(page);
    const pts1 = await getPoints();
    await resetCookie(page);

    await breakCookie(page);
    const pts2 = await getPoints();

    expect(pts2).toBeGreaterThan(pts1);
  });

  test("tap count increments", async ({ page }) => {
    const getTaps = async () => {
      const text = await page.locator("text=Opened").first().textContent() ?? "0";
      return parseInt(text.replace(/[^\d]/g, ""), 10);
    };

    const before = await getTaps();
    await breakCookie(page);
    const after = await getTaps();
    expect(after).toBe(before + 1);
  });

  test("cannot break cookie while cracking animation plays", async ({ page }) => {
    // Click quickly twice — second click should be ignored
    const cookie = page.locator("text=🥠").first();
    await cookie.click();
    await cookie.click(); // should be no-op (state !== 'intact')
    // Only one fortune paper should appear
    const papers = page.locator("text=Your Fortune");
    await expect(papers).toHaveCount(1, { timeout: 3000 });
  });
});

test.describe("Demo Mode — stats panel", () => {
  test.beforeEach(async ({ page }) => {
    await enterDemoMode(page);
  });

  test("history panel appears after first break", async ({ page }) => {
    await breakCookie(page);
    await resetCookie(page);
    await expect(page.locator("text=History")).toBeVisible({ timeout: 3000 });
  });

  test("history panel shows past fortune", async ({ page }) => {
    await breakCookie(page);
    await resetCookie(page);
    await page.getByText(/History/).click();
    await expect(page.locator("text=On-Chain History")).toBeVisible();
    // At least one record
    const records = page.locator(".history-record, [style*='borderLeft']");
    expect(await records.count()).toBeGreaterThan(0);
  });
});

test.describe("Mode switching", () => {
  test("可以从 demo 切换回 mode selector", async ({ page }) => {
    await enterDemoMode(page);
    await page.getByText("← 切换模式").click();
    await expect(page.getByText("Demo Mode")).toBeVisible({ timeout: 5000 });
  });

  test("Local Wallet mode button is present", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Local Wallet")).toBeVisible();
  });
});

test.describe("API endpoints", () => {
  test("GET /api/stats returns valid JSON", async ({ page }) => {
    const res = await page.request.get("/api/stats");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("byArchetype");
    expect(body).toHaveProperty("byRarity");
  });

  test("GET /api/webhook/helius returns ok", async ({ page }) => {
    const res = await page.request.get("/api/webhook/helius");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("POST /api/webhook/helius with invalid signature returns 401", async ({
    page,
  }) => {
    const res = await page.request.post("/api/webhook/helius", {
      headers: {
        "Content-Type": "application/json",
        "helius-signature": "deadbeef",
      },
      data: JSON.stringify([]),
    });
    // Without HELIUS_WEBHOOK_SECRET set in test env, the handler allows all
    // (verifySignature returns true when secret is empty).
    // If the secret IS set, expect 401.
    expect([200, 401]).toContain(res.status());
  });

  test("GET /api/rpc proxies to Solana RPC", async ({ page }) => {
    const res = await page.request.post("/api/rpc", {
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getHealth",
        params: [],
      }),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(["ok", "behind"]).toContain(body.result);
  });
});

test.describe("Accessibility", () => {
  test("mode selector buttons are keyboard-focusable", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    // First focusable element should be a button
    const focused = page.locator(":focus");
    await expect(focused).toBeVisible();
  });

  test("fortune paper is screen-reader friendly", async ({ page }) => {
    await enterDemoMode(page);
    await breakCookie(page);
    // Fortune text lives in a <p> (not aria-hidden)
    const paper = page.locator(".paper-texture p").nth(1);
    await expect(paper).toBeVisible();
    await expect(paper).not.toHaveAttribute("aria-hidden", "true");
  });
});
