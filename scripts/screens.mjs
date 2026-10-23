// Takes UI screenshots at 1366x768 and 1920x1080 with Playwright (dev servers must be running).
// Usage: pnpm screens <user-code> <path> [<path> ...]     e.g. pnpm screens off-NR-1 / /queue
// Also reports console errors and horizontal overflow for each page. Output goes to screenshots/.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { webUrl } from "./ports.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = webUrl(); // http://localhost:WEB_PORT (default 3001), or ARGUS_URL
const [code = "off-NR-1", ...paths] = process.argv.slice(2);
const sizes = (process.env.SIZES ?? "1366x768,1920x1080").split(",").map((s) => s.split("x").map(Number));
const fullPage = process.env.FULL !== "0";
const outDir = path.join(root, "screenshots");
mkdirSync(outDir, { recursive: true });

// Uses the installed Microsoft Edge by default (no browser download needed on Windows).
// Set PW_CHANNEL=chromium to use Playwright's own browser after `npx playwright install chromium`.
const channel = process.env.PW_CHANNEL ?? "msedge";
const browser = await chromium.launch(channel === "chromium" ? {} : { channel });
for (const [width, height] of sizes) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/welcome`);
  const users = await (await page.request.get(`${base}/api/users/demo`)).json();
  const user = users.users.find((u) => u.code === code);
  if (!user) throw new Error(`unknown user ${code}`);
  await page.request.post(`${base}/api/session`, { data: { user_id: user.id } });
  for (const p of paths.length ? paths : ["/"]) {
    errors.length = 0;
    await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const name = `${code}_${p.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home"}_${width}.png`;
    await page.screenshot({ path: path.join(outDir, name), fullPage });
    console.log(`${name}  overflow=${overflow}px  console_errors=${errors.length}${errors.length ? "\n   " + errors.slice(0, 3).join("\n   ") : ""}`);
  }
  await context.close();
}
await browser.close();
