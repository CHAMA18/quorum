import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "recordings/demo/recon";
mkdirSync(OUT, { recursive: true });
const file = (name, text) => writeFileSync(`${OUT}/${name}.txt`, text, "utf8");

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const events = [];
page.on("response", (r) => {
  if (/\/api\/(auth\/login|muse|org\/auth\/login|cycle)/.test(r.url())) events.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`);
});

async function dump(name) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const data = await page.evaluate(() => {
    const q = (sel) => [...document.querySelectorAll(sel)];
    return {
      url: location.href,
      hash: location.hash,
      inputs: q("input, textarea, select").map((el) => `${el.tagName}${el.getAttribute("type") ? `[${el.getAttribute("type")}]` : ""}:${el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || el.id}`),
      buttons: q("button, a[role=button]").map((el) => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 70)).filter(Boolean).slice(0, 80),
      tabs: q("[role=tab]").map((el) => (el.textContent || "").trim().slice(0, 40)),
      text: document.body.innerText.replace(/\n{2,}/g, "\n").slice(0, 2500),
    };
  });
  file(name, JSON.stringify(data, null, 1));
  console.log(`--- ${name} --- ${data.url} ${data.hash}`);
  console.log("inputs:", data.inputs.join(" | "));
  console.log("buttons:", data.buttons.slice(0, 30).join(" / "));
  console.log("tabs:", data.tabs.join(" / "));
  console.log("events:", events.slice(-6).join(" ; "));
}

await page.goto(`${BASE}/#/login`, { waitUntil: "networkidle" });
await page.fill('input[type="email"]', "chungu424@gmail.com");
await page.fill('input[type="password"]', "Chungu1998");
await page.locator('input[type="password"]').press("Enter");
await page.waitForTimeout(3000);
await dump("02-dashboard");

const cycleNav = page.getByRole("button", { name: /Tender Workflow/i }).first();
if (await cycleNav.count()) {
  await cycleNav.click();
  await page.waitForTimeout(3000);
  await dump("03-cycle");
  const tender = page.getByRole("button", { name: /Tender: .*KE-MOH-2026-117/i }).first();
  console.log("tender selector count:", await page.getByRole("button", { name: /Tender:/ }).count());
  if (await tender.count()) { await tender.click(); await page.waitForTimeout(600); }
  await page.getByRole("button", { name: /Award Decision/i }).first().click().catch(() => {});
  await page.waitForTimeout(2000);
  await dump("03b-award");
}

await page.goto(`${BASE}/org`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^Sign in$/i }).first().click().catch(() => {});
await page.waitForTimeout(800);
await dump("04-org-login");
await page.fill('input[type="email"]', "e2e.savanna@example.com");
await page.fill('input[type="password"]', "Chungu1998");
await page.locator('input[type="password"]').press("Enter");
await page.waitForTimeout(3500);
await dump("05-org-dashboard");
const assistant = page.getByRole("button", { name: /Quorum assistant/i }).first();
console.log("org assistant bubble count:", await assistant.count());
if (await assistant.count()) {
  await assistant.click();
  await page.waitForTimeout(800);
  const box = page.getByRole("textbox").first();
  if (await box.count()) { await box.fill("What is my contract status on KE-MOH-2026-117?"); await box.press("Enter"); await page.waitForTimeout(4000); }
  await dump("05b-org-assistant");
}

await browser.close();
