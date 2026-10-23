// Clicks through the main demo path in the real UI as each role and fails on console errors.
// Needs `pnpm dev` running. Resets the demo data first. Usage: pnpm e2e
import { chromium } from "playwright";
import { webUrl } from "./ports.mjs";

const base = webUrl(); // http://localhost:WEB_PORT (default 3001), or ARGUS_URL
const channel = process.env.PW_CHANNEL ?? "msedge";
const browser = await chromium.launch(channel === "chromium" ? {} : { channel });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(`${page.url()}: ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`${page.url()}: ${e}`));

const users = (await (await page.request.get(`${base}/api/users/demo`)).json()).users;
const id = (code) => users.find((u) => u.code === code).id;
async function as(code) { await page.request.post(`${base}/api/session`, { data: { user_id: id(code) } }); }
let n = 0;
async function step(label, fn) {
  n += 1;
  process.stdout.write(`${String(n).padStart(2)}. ${label} ... `);
  await fn();
  console.log("ok");
}
const click = (name, opts = {}) => page.getByRole("button", { name, exact: opts.exact ?? false }).first().click();
const expectText = (t) => page.getByText(t).first().waitFor({ timeout: 10000 });

await page.goto(`${base}/login`);
await page.request.post(`${base}/api/session`, { data: { user_id: id("off-NR-1") } });
await page.request.post(`${base}/api/demo/reset`);
// scripted demo cases from the synthetic dataset (stable ids: the seed is deterministic)
const SCRUTINY = 55, DECISION = 21, SAC = 22;

await step("official returns the case with a reason", async () => {
  await as("off-NR-1");
  await page.goto(`${base}/applications/${SCRUTINY}`);
  await click("Return with deficiency");
  await page.getByRole("dialog").locator("textarea").first().fill("Faculty list is short of the required cadre ratio. Upload revised details.");
  await click("Draft letter");
  await expectText("SYNTHETIC DATA - prototype draft");
  await click("Return to institution");
  await expectText("Paused");
});

await step("institution replies with a file", async () => {
  await as("inst-AMB");
  await page.goto(`${base}/applications/${SCRUTINY}`);
  await click("Reply to deficiency");
  await page.getByRole("dialog").locator("textarea").fill("Revised faculty list with appointment letters uploaded.");
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles({ name: "faculty.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await expectText("faculty.pdf (v1)");
  await click("Send reply");
  await expectText("Re-scrutiny");
});

await step("official completes re-scrutiny; case moves to EVC", async () => {
  await as("off-NR-1");
  await page.goto(`${base}/applications/${SCRUTINY}`);
  await click("Complete scrutiny");
  await click("Confirm");
  await expectText("Now: Expert Visit (EVC)");
});

await step("official assigns EVC members", async () => {
  await click("Assign EVC members");
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="checkbox"]').nth(0).check();
  await dialog.locator('input[type="checkbox"]').nth(1).check();
  await dialog.locator('input[type="radio"]').nth(0).check();
  await dialog.getByRole("button", { name: /Assign \d members/ }).click();
  await expectText("Members confirming available dates");
});

await step("clock +7d fires alerts", async () => {
  await page.getByRole("button", { name: /^Simulated date/ }).click();
  await page.getByRole("button", { name: "+7 days" }).click();
  await expectText(/7 days advanced: \d+ reminders? sent/);
});

await step("institution uploads undertaking evidence", async () => {
  await as("inst-AMB");
  await page.goto(`${base}/undertakings`);
  await page.locator("textarea").first().fill("Purchase invoices and installation report for the laboratory equipment.");
  await click("Submit evidence");
  await expectText("Your evidence is with AICTE");
});

await step("official verifies the evidence", async () => {
  await as("off-NR-1");
  await page.goto(`${base}/compliance`);
  await page.getByRole("button", { name: "Verify", exact: true }).first().click();
  await expectText("Evidence verified.");
});

await step("regional director records a decision with an undertaking", async () => {
  await as("rd-NR");
  await page.goto(`${base}/applications/${DECISION}`);
  await click("Record decision");
  const dialog = page.getByRole("dialog");
  await dialog.locator("textarea").fill("Approved subject to the undertaking below, as recommended.");
  await dialog.getByPlaceholder("Condition the institution must meet").fill("Appoint two additional faculty members.");
  await dialog.getByRole("button", { name: /Record decision as/ }).click();
  await expectText("Decision recorded: Approved with undertakings");
});

await step("SAC member records a recommendation", async () => {
  await as("sac-1");
  await page.goto(`${base}/cases/${SAC}`);
  await click("Record recommendation");
  await page.getByRole("dialog").locator("textarea").fill("Committee notes the visit findings and recommends approval.");
  await page.getByRole("dialog").getByRole("button", { name: "Record recommendation" }).click();
  await expectText("Recommended");
});

await step("EVC member confirms availability", async () => {
  await as("evc-1");
  await page.goto(`${base}/my-cases`);
  await page.getByRole("row", { name: /^Open visit for/ }).first().waitFor();
  const visits = (await (await page.request.get(`${base}/api/dashboard`)).json()).visits;
  const v = visits.find((x) => x.my_action === "Confirm your availability");
  await page.goto(`${base}/visits/${v.id}`);
  await click("Confirm availability");
  await page.getByRole("dialog").getByRole("button").nth(3).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit" }).click();
  await expectText("Thank you. Your availability is recorded.");
});

await step("bureau officer changes a time limit", async () => {
  await as("bureau-head");
  await page.goto(`${base}/settings/rules`);
  const limits = page.locator("#limits");
  await limits.locator('input[type="number"]').first().fill("8");
  await limits.getByRole("button", { name: "Save" }).first().click();
  await expectText(/: 8 days\./);
});

await step("audit chain verifies", async () => {
  await page.goto(`${base}/audit`);
  await click("Verify audit chain");
  await expectText("Chain intact");
});

await step("log out; pages and APIs refuse; log back in as another role", async () => {
  await as("inst-AMB");
  await page.goto(`${base}/`);
  await page.getByRole("heading", { level: 1, name: "Ambervale Institute of Technology" }).waitFor();
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await page.waitForURL(`${base}/login`);
  for (const api of ["/api/dashboard", "/api/applications", "/api/undertakings"]) {
    const r = await page.request.get(`${base}${api}`);
    if (r.status() !== 401) throw new Error(`${api} answered ${r.status()} after logout`);
  }
  await page.goto(`${base}/undertakings`);
  await page.waitForURL(`${base}/login`);
  await page.getByRole("button", { name: /Arjun Wrenfield/ }).click();
  await page.waitForURL(`${base}/`);
  await page.getByRole("heading", { level: 1, name: "Dashboard" }).waitFor();
  const inst = await page.request.get(`${base}/api/applications/${SCRUTINY}`);
  if (inst.status() !== 200) throw new Error(`official cannot open the case: ${inst.status()}`);
});

await step("every page renders for every role", async () => {
  const pages = {
    "off-NR-1": ["/", "/queue", "/applications", "/evc", "/compliance", "/validity", "/escalations", "/reports", "/audit", "/notifications", "/performance", "/guide"],
    "inst-AMB": ["/", "/applications", "/undertakings", "/documents", "/notifications"],
    "evc-1": ["/my-cases", "/notifications"],
    "bureau-head": ["/settings/rules", "/"],
  };
  for (const [code, paths] of Object.entries(pages)) {
    await as(code);
    for (const p of paths) {
      await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
      await page.locator("h1").first().waitFor();
    }
  }
});

await page.request.post(`${base}/api/demo/reset`);
await browser.close();
if (errors.length) {
  console.error(`\n${errors.length} console error(s):\n` + errors.slice(0, 10).join("\n"));
  process.exit(1);
}
console.log(`\nAll ${n} UI steps passed with no console errors.`);
