// Takes the screenshots used in the README (docs/screenshots/), at 1440x900 (dev servers must be running).
// Usage: node scripts/readme-shots.mjs     Reset the demo first so the images match docs/DEMO.md.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { webUrl } from "./ports.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = webUrl();
const outDir = path.join(root, "docs", "screenshots");
mkdirSync(outDir, { recursive: true });

const SHOTS = [
  { file: "official-dashboard.png", user: "bureau-head", path: "/" },
  { file: "case-page.png", user: "off-NR-1", path: "/applications/29" },
  { file: "institution-home.png", user: "inst-AMB", path: "/" },
  { file: "escalations.png", user: "bureau-head", path: "/escalations", click: "tbody tr" },
  { file: "evc-board.png", user: "bureau-head", path: "/evc" },
  { file: "rules.png", user: "bureau-head", path: "/settings/rules", scrollTo: "Reminders" },
];

const channel = process.env.PW_CHANNEL ?? "msedge";
const browser = await chromium.launch(channel === "chromium" ? {} : { channel });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.goto(`${base}/welcome`);
// hide the "What to do here" tips so the screenshots show the page itself
await page.evaluate(() => ["inst-home", "dashboard", "escalations", "evc", "rules"].forEach((id) => localStorage.setItem(`argus.help.${id}`, "hidden")));
const users = (await (await page.request.get(`${base}/api/users/demo`)).json()).users;

for (const s of SHOTS) {
  const user = users.find((u) => u.code === s.user);
  await page.request.post(`${base}/api/session`, { data: { user_id: user.id } });
  await page.goto(`${base}${s.path}`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); // the dev-mode badge
  await page.waitForTimeout(900);
  if (s.scrollTo) {
    await page.getByRole("heading", { name: s.scrollTo, exact: true }).first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 96));
    await page.waitForTimeout(500);
  }
  if (s.click) {
    await page.locator(s.click).first().click();
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: path.join(outDir, s.file) });
  console.log(s.file);
}
await browser.close();
