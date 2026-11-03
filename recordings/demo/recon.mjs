import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "recordings/demo/recon";
mkdirSync(OUT, { recursive: true });

const file = (name, text) => writeFileSync(`${OUT}/${name}.txt`, text, "utf8");

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

async function dump(name) {
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  const data = await page.evaluate(() => {
    const q = (sel) => [...document.querySelectorAll(sel)];
    return {
      url: location.href,
      inputs: q("input, textarea, select").map((el) => ({
        tag: el.tagName,
        type: el.getAttribute("type"),
        name: el.getAttribute("name"),
        id: el.id,
        placeholder: el.getAttribute("placeholder"),
        aria: el.getAttribute("aria-label"),
      })),
      buttons: q("button, a[role=button]").map((el) => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 90)).filter(Boolean).slice(0, 120),
      headings: q("h1, h2, h3").map((el) => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 100)).filter(Boolean).slice(0, 60),
      text: document.body.innerText.replace(/\n{2,}/g, "\n").slice(0, 3000),
    };
  });
  file(name, JSON.stringify(data, null, 1));
  console.log(`--- ${name} ---`, data.url);
  console.log("inputs:", data.inputs.map((i) => `${i.tag}${i.type ? `[${i.type}]` : ""}:${i.aria || i.placeholder || i.name || i.id}`).join(" | ").slice(0, 600));
  console.log("buttons:", data.buttons.slice(0, 40).join(" / "));
}

await page.goto(`${BASE}/#/login`, { waitUntil: "networkidle" });
await dump("01-login");

await page.fill('input[type="email"]', "chungu424@gmail.com");
await page.fill('input[type="password"]', "Chungu1998");
await page.getByRole("button", { name: /sign in/i }).first().click();
await page.waitForTimeout(2500);
await dump("02-dashboard");

const cycleNav = page.getByRole("button", { name: /Tender Workflow/i }).first();
if (await cycleNav.count()) {
  await cycleNav.click();
  await page.waitForTimeout(2500);
  await dump("03-cycle");
}

await page.goto(`${BASE}/org`, { waitUntil: "networkidle" });
await dump("04-org-login");

await browser.close();
