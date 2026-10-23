// Visits the home page as Institution, Official and Committee by clicking the role switcher in the
// top bar, takes a screenshot of each, and reports console errors and whether the clock is shown.
// Needs `pnpm dev`. Usage: pnpm screens:roles   (SIZE=1920x1080 to change the viewport)
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.ARGUS_URL ?? "http://localhost:3000";
const [width, height] = (process.env.SIZE ?? "1366x768").split("x").map(Number);
const channel = process.env.PW_CHANNEL ?? "msedge";
const out = path.join(root, "screenshots");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(channel === "chromium" ? {} : { channel });
const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

// first sign-in from the welcome page, then switch with the top-bar menu
await page.goto(`${base}/welcome`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Dr\. Kavya Larkspur/ }).click();
await page.waitForURL(`${base}/`);

const tour = [
  { role: "institution", name: null, heading: "Ambervale Institute of Technology" },
  { role: "official", name: /^Arjun Wrenfield/, heading: "Pendency dashboard" },
  { role: "committee", name: /^Prof\. Vikram Duskwood/, heading: "My cases" },
];
let failed = false;
for (const stop of tour) {
  errors.length = 0;
  if (stop.name) {
    await page.getByRole("button", { name: /^Switch demo user/ }).click();
    await page.getByRole("menuitem", { name: stop.name }).click();
  }
  await page.getByRole("heading", { level: 1, name: stop.heading }).waitFor({ timeout: 30000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1200);
  const clock = await page.getByText("Simulated date").isVisible();
  const date = (await page.locator("text=Simulated date").locator("xpath=following-sibling::div[1]").textContent())?.trim();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const file = path.join(out, `role-${stop.role}_${width}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`${stop.role.padEnd(11)} heading ok | clock visible: ${clock} (${date}) | overflow ${overflow}px | console errors: ${errors.length}`);
  if (errors.length) { failed = true; console.log("   " + errors.slice(0, 3).join("\n   ")); }
}
await browser.close();
process.exit(failed ? 1 : 0);
