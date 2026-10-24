// Production screenshots for the SIH presentation (1366x768) into screenshots/production/.
// Usage: pnpm shots:prod [https://your-app.vercel.app]. Resets the demo before and after; the case shots are
// taken 7 simulated days in, where the at-risk demo case (NR/0047) is High with a recommended action.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { root, webUrl } from "./ports.mjs";

const base = (process.argv[2] ?? webUrl()).replace(/\/+$/, "");
const out = path.join(root, "screenshots", "production");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHANNEL === "chromium" ? {} : { channel: process.env.PW_CHANNEL ?? "msedge" });
const users = (await (await fetch(`${base}/api/users/demo`)).json()).users;

async function as(code) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  await page.request.post(`${base}/api/auth/login`, { data: { user_id: users.find((u) => u.code === code).id } });
  return page;
}
async function shot(page, name, url, anchor) {
  await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
  await page.locator("h1").first().waitFor();
  if (anchor) {
    await page.locator(anchor).first().waitFor();
    await page.evaluate((sel) => { const el = document.querySelector(sel); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 92); }, anchor);
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(`saved ${name}.png`);
}

const off = await as("off-NR-1");
await off.request.post(`${base}/api/demo/reset`);

await shot(await as("inst-IRO"), "3-institution-home", "/");
await shot(await as("evc-1"), "4-committee-my-cases", "/my-cases");
await shot(off, "5-performance", "/performance");
await shot(off, "6-performance-intelligence", "/performance", "#intelligence");

await off.request.post(`${base}/api/clock/advance`, { data: { days: 7 } });
const atRisk = (await (await off.request.get(`${base}/api/applications?q=NR/0047`)).json()).rows[0].id;
await shot(off, "1-official-dashboard", "/");
await shot(off, "2-case-why-at-risk", `/applications/${atRisk}`, "#risk");
await shot(off, "2b-case-recommended-action", `/applications/${atRisk}`, "#recommendation");
await shot(off, "2c-case-top", `/applications/${atRisk}`);

await off.request.post(`${base}/api/demo/reset`);
await browser.close();
console.log(`Done; demo reset. Files in ${path.relative(root, out)}`);
