// Full test of a running Argus (the deployed site or local dev) through the real UI and API, as every role.
// Usage: pnpm live-test [https://your-app.vercel.app]   (default: ARGUS_URL, then the local web port)
// Needs CRON_SECRET (environment or .env) for the cron and reset checks. Secret values are only used to call the
// cron endpoints and to scan responses for leaks; they are never printed. Starts and ends with a clean reset.
// Results: test-results/live/results.json, plus a screenshot for every failed check.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { root, webUrl } from "./ports.mjs";

const base = (process.argv[2] ?? webUrl()).replace(/\/+$/, "");
const out = path.join(root, "test-results", "live");
mkdirSync(out, { recursive: true });

// ------------------------------------------------------------------ secrets (kept in memory only)
const dotenv = {};
try {
  for (const raw of readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
    if (m) dotenv[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch { /* no .env */ }
const env = (k) => process.env[k] ?? dotenv[k] ?? "";
const CRON = env("CRON_SECRET");
const secrets = ["DATABASE_URL", "SESSION_SECRET", "CRON_SECRET", "GROQ_API_KEY"].map(env).filter((v) => v.length >= 8);
const dbPassword = env("DATABASE_URL").match(/:\/\/[^:]+:([^@]+)@/)?.[1];
if (dbPassword && dbPassword.length >= 8) secrets.push(dbPassword);

// ------------------------------------------------------------------ bookkeeping
const results = [];
const consoleErrors = [];
const serverErrors = [];
const leaks = new Set();
const retries = [];
let scanned = 0;
let cur = null; // page to screenshot when a check fails

function watch(page) {
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${page.url()}: ${m.text().slice(0, 200)}`); });
  page.on("pageerror", (e) => consoleErrors.push(`${page.url()}: ${String(e).slice(0, 200)}`));
  page.on("response", async (r) => {
    if (!r.url().startsWith(base)) return;
    if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.request().method()} ${r.url().replace(base, "")}`);
    if (!secrets.length || !/json|javascript|html|text|css/.test(r.headers()["content-type"] ?? "")) return;
    try {
      const body = await r.text();
      scanned += 1;
      if (secrets.some((s) => body.includes(s))) leaks.add(r.url().replace(base, ""));
    } catch { /* redirects and aborted requests have no body */ }
  });
  return page;
}

async function check(section, name, fn) {
  const t = performance.now();
  process.stdout.write(`[${section}] ${name} ... `);
  try {
    const detail = await fn();
    results.push({ section, name, ok: true, ms: Math.round(performance.now() - t), detail: detail ?? "" });
    console.log(`ok${detail ? ` (${detail})` : ""}`);
  } catch (e) {
    const shot = `fail-${results.length + 1}.png`;
    try { if (cur) await cur.screenshot({ path: path.join(out, shot) }); } catch { /* page closed */ }
    const msg = String(e?.message ?? e).split("\n")[0].slice(0, 300);
    results.push({ section, name, ok: false, ms: Math.round(performance.now() - t), detail: msg, screenshot: shot });
    console.log(`FAIL: ${msg}`);
  }
}

const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const timed = async (fn) => { const t = performance.now(); const r = await fn(); return [r, Math.round(performance.now() - t)]; };

// ------------------------------------------------------------------ browser helpers
const VP = { width: 1366, height: 768 };
const browser = await chromium.launch(process.env.PW_CHANNEL === "chromium" ? {} : { channel: process.env.PW_CHANNEL ?? "msedge" });
const contexts = [];
async function anon(viewport = VP) {
  const ctx = await browser.newContext({ viewport });
  contexts.push(ctx);
  return watch(await ctx.newPage());
}
const users = (await (await fetch(`${base}/api/users/demo`)).json()).users;
const U = (code) => users.find((u) => u.code === code);
async function session(code, viewport = VP) {
  const page = await anon(viewport);
  const r = await page.request.post(`${base}/api/auth/login`, { data: { user_id: U(code).id } });
  must(r.ok(), `login as ${code} answered ${r.status()}`);
  return page;
}
const text = (page, t, timeout = 20000) => page.getByText(t).first().waitFor({ timeout });
const click = (page, name, exact = false) => page.getByRole("button", { name, exact }).first().click();
/** API call through the page's cookies. A dropped connection (no HTTP answer) is retried once and noted;
 *  browsers do the same for idle keep-alive connections the edge has closed. */
async function req(page, method, url, data) {
  const call = () => page.request[method](`${base}${url}`, data ? { data } : undefined);
  try { return await call(); } catch (e) { retries.push(`${method.toUpperCase()} ${url}: ${String(e.message).split("\n")[0]}`); return call(); }
}
const getJson = async (page, url) => { const r = await req(page, "get", url); must(r.ok(), `${url} answered ${r.status()}`); return r.json(); };
const status = async (page, method, url, data) => (await req(page, method, url, data)).status();
/** Cron endpoints from Node. A network error (not an HTTP status) is retried once and noted in the results. */
async function cron(method, url, auth) {
  const call = () => fetch(`${base}${url}`, { method, headers: auth ? { Authorization: auth } : {} });
  try { return await call(); } catch (e) { retries.push(`${method} ${url}: ${e.cause?.code ?? e.message}`); return call(); }
}
const go = async (page, url, h1 = true) => {
  cur = page;
  await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
  if (h1) await page.locator("h1").first().waitFor({ timeout: 20000 });
};

/** The same sentence the clock toast builds from the engine's counts (frontend/lib/actions.ts). */
function advanceSummary(r) {
  const parts = [`${r.reminders ?? 0} reminder${r.reminders === 1 ? "" : "s"} sent`, `${r.overdue ?? 0} item${r.overdue === 1 ? "" : "s"} overdue`];
  const levels = [1, 2, 3].map((l) => [l, r[`escalated_l${l}`] ?? 0]).filter(([, n]) => n > 0);
  parts.push(levels.length ? levels.map(([l, n], i) => (i === 0 ? `${n} escalated to L${l}` : `${n} to L${l}`)).join(", ") : "no new escalations");
  return `${r.days} day${r.days === 1 ? "" : "s"} advanced: ${parts.join(", ")}.`;
}
async function openClock(page) {
  if (!(await page.getByRole("button", { name: "+1 day" }).isVisible())) await page.getByRole("button", { name: /^Simulated date/ }).click();
}
async function advanceInUi(page, label) {
  await openClock(page);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/clock/advance"), { timeout: 60000 }),
    page.getByRole("button", { name: label }).click(),
  ]);
  must(resp.ok(), `advance answered ${resp.status()}`);
  const body = await resp.json();
  const expected = advanceSummary(body);
  await text(page, expected, 20000);
  return body;
}

const timings = {};
const ids = {};

// ================================================================== 1. health and timings
await check("1 Health", "/api/health reports a connected, seeded database", async () => {
  const [r, ms] = await timed(() => fetch(`${base}/api/health`));
  timings.firstApiMs = ms;
  must(r.ok, `HTTP ${r.status}`);
  const h = await r.json();
  must(h.db === "connected" && h.schema_ok && h.seeded, JSON.stringify(h));
  const [, warm] = await timed(() => fetch(`${base}/api/health`));
  timings.warmApiMs = warm;
  return `first request ${ms} ms, warm ${warm} ms, schema ${h.schema_version}`;
});

await check("1 Health", "reset to the seeded state through /api/cron/reset", async () => {
  const r = await cron("POST", "/api/cron/reset", `Bearer ${CRON}`);
  must(r.ok, `HTTP ${r.status}`);
  const b = await r.json();
  must(b.clock.today === "2026-05-15", `clock at ${b.clock.today}`);
});

await check("1 Health", "first page load (logged out, ends on /login)", async () => {
  const p = await anon();
  cur = p;
  const [, ms] = await timed(async () => {
    await p.goto(`${base}/`);
    await p.waitForURL(/\/login/, { timeout: 30000 });
    await p.locator("h1").first().waitFor();
  });
  timings.firstPageMs = ms;
  return `${ms} ms`;
});

await check("7 Time", "cron tick: 401 without or with a wrong secret, 200 with it, idempotent", async () => {
  must((await cron("GET", "/api/cron/tick")).status === 401, "no secret was accepted");
  must((await cron("GET", "/api/cron/tick", "Bearer wrong")).status === 401, "wrong secret was accepted");
  must((await cron("POST", "/api/cron/reset")).status === 401, "reset without secret was accepted");
  const a = await cron("GET", "/api/cron/tick", `Bearer ${CRON}`);
  must(a.ok, `tick answered ${a.status}`);
  const b = await (await cron("GET", "/api/cron/tick", `Bearer ${CRON}`)).json();
  must(b.alerts === 0 && b.escalations === 0, `second tick created ${b.alerts} alerts`);
  return "second run created 0 alerts";
});

// ================================================================== ids used below (stable: the seed is deterministic)
const bureau = await session("bureau-head");
const all = (await getJson(bureau, "/api/applications")).rows ?? [];
const byRef = (ref) => all.find((a) => a.ref_no === ref)?.id;
ids.scrutiny = byRef("ARG/2026/NR/0055");
ids.atRisk = byRef("ARG/2026/NR/0047");
ids.decision = 21;
ids.sac = 22;
ids.visitReportApp = byRef("ARG/2026/NR/0032");
ids.dateApp = byRef("ARG/2026/NR/0056");
const amb = U("inst-AMB");
ids.otherInstApp = all.find((a) => a.institution && a.institution !== amb.institution)?.id;
ids.intakeApp = all.find((a) => a.stage_code === "intake")?.id ?? ids.otherInstApp;

// ================================================================== 2. auth and scope
await check("2 Auth", "logged out: pages redirect to /login, APIs answer 401", async () => {
  const p = await anon();
  cur = p;
  await p.goto(`${base}/audit`);
  await p.waitForURL(/\/login/, { timeout: 30000 });
  for (const api of ["/api/dashboard", "/api/applications", "/api/audit"]) must(await status(p, "get", api) === 401, `${api} not 401`);
});

const roles = [["inst-AMB", "Institution"], ["off-NR-1", "Regional officer"], ["bureau-head", "Bureau officer"], ["evc-1", "EVC member"], ["sac-1", "SAC/SHC member"]];
const ui = {};
for (const [code, label] of roles) {
  await check("2 Auth", `log in from /login as ${label} (${U(code).name})`, async () => {
    const p = await anon();
    cur = p;
    await p.goto(`${base}/login`);
    await p.getByRole("button", { name: new RegExp(U(code).name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
    await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
    await p.locator("h1").first().waitFor();
    const s = await getJson(p, "/api/session");
    must(s.user?.id === U(code).id, "session is for another user");
    ui[code] = p;
    return `landed on ${new URL(p.url()).pathname}`;
  });
}

await check("2 Auth", "session cookie is HttpOnly, Secure (on https) and SameSite=Lax", async () => {
  const c = (await ui["off-NR-1"].context().cookies()).find((x) => x.name === "argus_session");
  must(c, "no session cookie");
  must(c.httpOnly && c.sameSite === "Lax", JSON.stringify({ httpOnly: c.httpOnly, sameSite: c.sameSite }));
  must(!base.startsWith("https") || c.secure, "cookie not Secure on https");
});

await check("2 Auth", "institution sees only its own data; official pages and APIs refused", async () => {
  const p = ui["inst-AMB"];
  cur = p;
  const mine = (await getJson(p, "/api/applications")).rows;
  must(mine.length > 0 && mine.every((a) => !a.institution || a.institution === amb.institution), "list has another institution's case");
  must([403, 404].includes(await status(p, "get", `/api/applications/${ids.otherInstApp}`)), "could open another institution's case");
  must(await status(p, "get", "/api/audit") === 403, "audit API not refused");
  await go(p, "/audit", false);
  await text(p, "The audit trail is visible to officials.");
  return `${mine.length} own applications`;
});

await check("2 Auth", "committee member cannot open unassigned cases or official pages", async () => {
  const p = ui["evc-1"];
  cur = p;
  must([403, 404].includes(await status(p, "get", `/api/applications/${ids.intakeApp}`)), "could open an unassigned case");
  must(await status(p, "get", "/api/queue") === 403, "queue API not refused");
  await go(p, "/queue", false);
  await text(p, "The work queue is for officials.");
});

await check("2 Auth", "only a Bureau officer can change rules", async () => {
  must(await status(ui["off-NR-1"], "put", "/api/rules/sla/scrutiny", { days: 21 }) === 403, "regional officer changed a rule");
  must(await status(ui["inst-AMB"], "put", "/api/rules/sla/scrutiny", { days: 21 }) === 403, "institution changed a rule");
  must(await status(ui["bureau-head"], "get", "/api/rules") === 200, "bureau cannot read rules");
});

await check("2 Auth", "log out from the avatar menu; pages redirect and APIs answer 401; log in as another role", async () => {
  const p = ui["inst-AMB"];
  cur = p;
  await go(p, "/");
  await p.getByRole("button", { name: /^Account menu/ }).click();
  await p.getByRole("menuitem", { name: "Log out" }).click();
  await p.waitForURL(/\/login/, { timeout: 30000 });
  for (const api of ["/api/dashboard", "/api/applications", "/api/undertakings"]) must(await status(p, "get", api) === 401, `${api} not 401 after logout`);
  await p.goto(`${base}/undertakings`);
  await p.waitForURL(/\/login/, { timeout: 30000 });
  await p.getByRole("button", { name: /Arjun Wrenfield/ }).first().click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await p.getByRole("heading", { level: 1, name: "Dashboard" }).waitFor();
  must(await status(p, "get", "/api/undertakings") !== 401, "new session not accepted");
});

// ================================================================== 3-5. institution, official and committee flows
const off = await session("off-NR-1");
const inst = await session("inst-AMB");

await check("4 Official", "work queue loads", async () => { await go(off, "/queue"); });

await check("4 Official", "return a case with a reason (deficiency letter drafted)", async () => {
  await go(off, `/applications/${ids.scrutiny}`);
  await click(off, "Return with deficiency");
  await off.getByRole("dialog").locator("textarea").first().fill("Faculty list is short of the required cadre ratio. Upload revised details.");
  await click(off, "Draft letter");
  await text(off, "SYNTHETIC DATA - prototype draft");
  await click(off, "Return to institution");
  await text(off, "Paused");
});

await check("3 Institution", "submit a new application and see it routed", async () => {
  await go(inst, "/applications?new=1");
  const dialog = inst.getByRole("dialog");
  await dialog.locator("input, textarea").first().fill("B.Tech Computer Science (live test, 60 seats)");
  await dialog.getByRole("button", { name: "Submit application" }).click();
  await text(inst, /Submitted as ARG\/2026\//);
  await inst.waitForURL(/\/applications\/\d+/);
  await text(inst, "Completeness check");
  return new URL(inst.url()).pathname;
});

let uploadedFile = null;
await check("3 Institution", "reply to the deficiency with a file under the limit", async () => {
  await go(inst, `/applications/${ids.scrutiny}`);
  await click(inst, "Reply to deficiency");
  const dialog = inst.getByRole("dialog");
  await dialog.locator("textarea").fill("Revised faculty list with appointment letters uploaded.");
  const [up] = await Promise.all([
    inst.waitForResponse((r) => r.url().endsWith("/api/files") && r.request().method() === "POST"),
    dialog.locator('input[type="file"]').setInputFiles({ name: "faculty.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 live test") }),
  ]);
  must(up.ok(), `upload answered ${up.status()}`);
  uploadedFile = await up.json();
  await text(inst, "faculty.pdf (v1)");
  await dialog.locator('input[type="file"]').setInputFiles({ name: "too-big.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(2.5 * 1024 * 1024, 65) });
  await text(inst, "Files must be 2 MB or smaller.");
  await click(inst, "Send reply");
  await text(inst, "Re-scrutiny");
  return `sha256 ${String(uploadedFile.sha256 ?? "").slice(0, 8)}`;
});

await check("3 Institution", "server refuses a file over 2 MB with a clear message", async () => {
  const r = await inst.request.post(`${base}/api/files`, {
    multipart: { entity_type: "application", entity_id: String(ids.scrutiny), slot: "attachment",
      file: { name: "big.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(2 * 1024 * 1024 + 10, 66) } },
  });
  must(r.status() >= 400 && r.status() < 500, `answered ${r.status()}`);
  const b = await r.json();
  must(/2 MB/.test(JSON.stringify(b)), "no friendly message");
  return `${r.status()}: ${b.detail ?? ""}`;
});

await check("3 Institution", "own file downloads; another institution gets refused", async () => {
  must(uploadedFile?.id, "no uploaded file from the previous check");
  must(await status(inst, "get", `/api/files/${uploadedFile.id}`) === 200, "owner cannot download");
  const other = await session("inst-IRO");
  must([403, 404].includes(await status(other, "get", `/api/files/${uploadedFile.id}`)), "another institution could download");
});

await check("3 Institution", "undertaking evidence submitted", async () => {
  await go(inst, "/undertakings");
  if (!(await inst.locator("textarea").first().isVisible())) await click(inst, "Submit evidence");
  await inst.locator("textarea").first().fill("Purchase invoices and installation report for the laboratory equipment.");
  await inst.getByRole("button", { name: "Submit evidence" }).last().click();
  await text(inst, "Your evidence is with AICTE");
});

await check("3 Institution", "document validity page shows statuses", async () => {
  await go(inst, "/documents");
  await text(inst, /Valid|Expiring soon|Expired|Renewal submitted/);
});

await check("4 Official", "verify the evidence (undertaking closed)", async () => {
  await go(off, "/compliance");
  await off.getByRole("button", { name: "Verify", exact: true }).first().click();
  await text(off, "Evidence verified.");
});

await check("4 Official", "complete re-scrutiny; the case moves to EVC", async () => {
  await go(off, `/applications/${ids.scrutiny}`);
  await click(off, "Complete scrutiny");
  await click(off, "Confirm");
  await text(off, "Now: Expert Visit (EVC)");
});

await check("4 Official", "assign EVC members", async () => {
  await click(off, "Assign EVC members");
  const dialog = off.getByRole("dialog");
  await dialog.locator('input[type="checkbox"]').nth(0).check();
  await dialog.locator('input[type="checkbox"]').nth(1).check();
  await dialog.locator('input[type="radio"]').nth(0).check();
  await dialog.getByRole("button", { name: /Assign \d members/ }).click();
  await text(off, "Members confirming available dates");
});

await check("4 Official", "reassign the case to another officer", async () => {
  await go(off, `/applications/${ids.scrutiny}`);
  await click(off, "Reassign");
  const dialog = off.getByRole("dialog");
  await dialog.locator('input[type="radio"]:not([disabled])').first().check();
  await dialog.getByRole("button", { name: "Reassign" }).click();
  await text(off, "Case reassigned.");
});

await check("5 Committee", "EVC member: my cases, confirm availability", async () => {
  const p = ui["evc-1"];
  await go(p, "/my-cases");
  const v = (await getJson(p, "/api/dashboard")).visits.find((x) => x.my_action === "Confirm your availability");
  must(v, "no visit waiting for availability");
  await go(p, `/visits/${v.id}`);
  await click(p, "Confirm availability");
  await p.getByRole("dialog").getByRole("button").nth(3).click();
  await p.getByRole("dialog").getByRole("button", { name: "Submit" }).click();
  await text(p, "Thank you. Your availability is recorded.");
});

await check("4 Official", "fix the visit date once members have offered dates", async () => {
  await go(off, `/applications/${ids.dateApp}`);
  await click(off, "Fix visit date");
  await off.getByRole("dialog").getByRole("button", { name: "Fix date" }).click();
  await text(off, "Visit date fixed.");
});

await check("5 Committee", "EVC member marks the visit conducted and submits the report", async () => {
  const p = ui["evc-1"];
  const v = (await getJson(p, "/api/dashboard")).visits.find((x) => x.application_id === ids.visitReportApp);
  must(v, "visit for NR/0032 not on my cases");
  await go(p, `/visits/${v.id}`);
  await click(p, "Mark visit conducted");
  await click(p, "Submit visit report");
  await p.getByRole("dialog").locator("textarea").fill("Laboratories, library and faculty records checked; facilities match the application.");
  await p.getByRole("dialog").getByRole("button", { name: "Submit report" }).click();
  await text(p, "Report submitted for the officer's review.");
});

await check("5 Committee", "SAC/SHC member records a recommendation", async () => {
  const p = ui["sac-1"];
  await go(p, "/my-cases");
  await go(p, `/cases/${ids.sac}`);
  await click(p, "Record recommendation");
  await p.getByRole("dialog").locator("textarea").fill("Committee notes the visit findings and recommends approval.");
  await p.getByRole("dialog").getByRole("button", { name: "Record recommendation" }).click();
  await text(p, "Recommended");
});

await check("5 Committee", "competent authority records the decision with an undertaking", async () => {
  const p = await session("rd-NR");
  await go(p, `/applications/${ids.decision}`);
  await click(p, "Record decision");
  const dialog = p.getByRole("dialog");
  await dialog.locator("textarea").fill("Approved subject to the undertaking below, as recommended.");
  await dialog.getByPlaceholder("Condition the institution must meet").fill("Appoint two additional faculty members.");
  await dialog.getByRole("button", { name: /Record decision as/ }).click();
  await text(p, "Decision recorded: Approved with undertakings");
});

await check("4 Official", "escalations page lists overdue items by level", async () => {
  await go(off, "/escalations");
  await text(off, "Level 1");
  await off.getByText("All Regions", { exact: true }).click();
  await off.getByRole("columnheader", { name: "Days late" }).waitFor();
  must(await off.locator("tbody tr").count() > 0, "no escalation rows");
});

await check("4 Official", "reports load, CSV export works, totals match the dashboard", async () => {
  await go(off, "/reports");
  const csv = await off.request.get(`${base}/api/reports/pendency?format=csv`);
  must(csv.ok() && /text\/csv/.test(csv.headers()["content-type"]), "CSV export failed");
  const lines = (await csv.text()).trim().split("\n").length;
  const dash = await getJson(bureau, "/api/dashboard?all_regions=true");
  const pend = await getJson(bureau, "/api/reports/pendency");
  must(JSON.stringify(pend.totals) === JSON.stringify(dash.totals), "pendency totals differ from the dashboard");
  return `${lines} CSV lines`;
});

await check("4 Official", "audit page: Verify audit chain says intact", async () => {
  await go(off, "/audit");
  await click(off, "Verify audit chain");
  await text(off, "Chain intact");
});

await check("4 Official", "Bureau officer edits a time limit; saved and in the change history", async () => {
  const p = ui["bureau-head"];
  await go(p, "/settings/rules");
  const limits = p.locator("#limits");
  await limits.locator('input[type="number"]').first().fill("8");
  await limits.getByRole("button", { name: "Save" }).first().click();
  await text(p, /: 8 days\./);
  await go(p, "/settings/rules");
  must(await p.locator("#limits").locator('input[type="number"]').first().inputValue() === "8", "value not kept after reload");
  const r = await getJson(p, "/api/audit?action=rule.changed&limit=5");
  must(r.rows.length > 0, "no rule.changed audit entry");
});

// ================================================================== 6-7. intelligence, time and alerts
let before = {};
const outboxTotal = async () => (await getJson(bureau, "/api/outbox?everyone=true")).counts.reduce((n, c) => n + c.n, 0);
await check("6 Intelligence", "dashboard shows risk bands, Needs attention and Where delays are building", async () => {
  await go(off, "/");
  await off.getByRole("heading", { name: "Needs attention" }).waitFor();
  await off.getByRole("heading", { name: "Where delays are building" }).waitFor();
  for (const band of ["High", "Medium", "Low"]) await text(off, new RegExp(`^${band}`));
  const o = await getJson(off, "/api/intelligence/overview");
  before = { risk: (await getJson(off, `/api/applications/${ids.atRisk}/risk`)).assessment.score, dash: (await getJson(off, "/api/dashboard")).totals,
    version: (await getJson(off, "/api/live")).version, outbox: await outboxTotal() };
  return `High ${o.counts.high}, Medium ${o.counts.medium}, Low ${o.counts.low}`;
});

await check("7 Time", "+1 day from the clock chip: toast matches the engine's counts", async () => {
  await go(off, "/");
  const r = await advanceInUi(off, "+1 day");
  return advanceSummary(r);
});

await check("7 Time", "+7 days: notifications, statuses and risk scores update", async () => {
  const r = await advanceInUi(off, "+7 days");
  const live = await getJson(off, "/api/live");
  must(live.version > before.version, "audit version did not move");
  must(live.clock.today === "2026-05-23", `clock at ${live.clock.today}`);
  const risk = (await getJson(off, `/api/applications/${ids.atRisk}/risk`)).assessment.score;
  must(risk !== before.risk, `risk score unchanged at ${risk}`);
  const outbox = await outboxTotal();
  must(outbox > before.outbox, "no new notifications in the simulated email/SMS log");
  return `${advanceSummary(r)} outbox +${outbox - before.outbox}, NR/0047 risk ${before.risk} -> ${risk}`;
});

await check("7 Time", "case lists show on track, due soon, overdue and escalated", async () => {
  await go(off, "/applications");
  for (const s of ["On track", "Due soon", "Overdue"]) await text(off, s);
  await go(off, "/escalations");
  await text(off, /Escalated L\d|L2|L3/);
});

let approvedRec = null;
await check("6 Intelligence", "case page: Why at risk and Recommended action; approve runs the action", async () => {
  const risk = await getJson(off, `/api/applications/${ids.atRisk}/risk`);
  must(risk.recommendation?.can_act, "no open recommendation this officer may approve");
  approvedRec = risk.recommendation;
  await go(off, `/applications/${ids.atRisk}`);
  await off.getByRole("heading", { name: "Why at risk" }).waitFor();
  await off.getByRole("button", { name: "How this was calculated" }).click();
  await text(off, "Score = 100");
  await off.locator("#recommendation").getByRole("button", { name: "Approve" }).click();
  await text(off, /^Approved\./);
  const after = await getJson(off, `/api/applications/${ids.atRisk}/risk`);
  const iv = after.interventions.find((i) => i.id === approvedRec.id);
  must(iv?.status === "approved", "intervention not approved");
  const audit = await getJson(off, `/api/audit?action=intervention.approved&application_id=${ids.atRisk}`);
  must(audit.rows.length > 0, "approval not in the audit log");
  return `${approvedRec.rule_label}: ${iv.decision_note ?? iv.effect ?? "done"}`;
});

await check("6 Intelligence", "dismiss a recommendation with a reason", async () => {
  let rec = null;
  let who = off;
  for (const [p, url] of [[off, "/api/intelligence/recommendations"], [bureau, "/api/intelligence/recommendations?all_regions=true"]]) {
    for (const r of await getJson(p, url)) {
      if (r.application_id === ids.atRisk) continue;
      if ((await getJson(p, `/api/applications/${r.application_id}/risk`)).recommendation?.can_act) { rec = r; who = p; break; }
    }
    if (rec) break;
  }
  must(rec, "no other open recommendation anyone here may dismiss");
  await go(who, `/applications/${rec.application_id}`);
  await who.locator("#recommendation").getByRole("button", { name: "Dismiss" }).click();
  const dialog = who.getByRole("dialog");
  await dialog.locator("textarea").fill("Officer has already phoned the institution about this.");
  await dialog.getByRole("button", { name: "Dismiss" }).click();
  await text(who, "Dismissed");
  const risk = await getJson(who, `/api/applications/${rec.application_id}/risk`);
  must(risk.interventions.some((i) => i.id === rec.id && i.status === "dismissed"), "not dismissed");
  return rec.rule_label ?? "";
});

await check("6 Intelligence", "roles without permission get 403 on approve and dismiss", async () => {
  const rec = (await getJson(bureau, "/api/intelligence/recommendations?all_regions=true"))[0];
  must(rec, "no open recommendation to try");
  const recRegion = all.find((a) => a.id === rec.application_id)?.region;
  const otherRegion = users.find((u) => u.role === "official" && u.official_kind === "regional" && u.region && u.region !== recRegion);
  const tries = { institution: await session("inst-AMB"), committee: await session("evc-1"), [`officer in ${otherRegion.region}`]: await session(otherRegion.code) };
  for (const [who, p] of Object.entries(tries)) {
    must(await status(p, "post", `/api/interventions/${rec.id}/accept`, {}) === 403, `${who} could approve`);
    must(await status(p, "post", `/api/interventions/${rec.id}/dismiss`, { reason: "Trying without permission here." }) === 403, `${who} could dismiss`);
  }
});

await check("7 Time", "+30 days: escalations climb and the approved action's outcome is measured", async () => {
  await go(off, "/");
  const r = await advanceInUi(off, "+30 days");
  const risk = await getJson(off, `/api/applications/${ids.atRisk}/risk`);
  const iv = risk.interventions.find((i) => i.id === approvedRec?.id);
  must(iv?.outcomes?.length > 0, "no outcome recorded for the approved action");
  return `${advanceSummary(r)} outcome: ${iv.outcomes.map((o) => `${o.checkpoint} risk ${o.score_after}`).join(", ")}`;
});

await check("7 Time", "Reset from the clock chip restores the seeded date", async () => {
  await openClock(off);
  await off.getByRole("button", { name: "Reset demo data and clock" }).click();
  await off.getByRole("button", { name: "Reset demo", exact: true }).click();
  await text(off, "Demo data and the simulated clock are back to the seeded state.");
  must((await getJson(off, "/api/clock")).today === "2026-05-15", "clock not reset");
});

// ================================================================== 8. live updates
await check("8 Live", "a second session sees the change by polling, without reload", async () => {
  const watcher = await session("off-NR-1");
  await go(watcher, "/");
  const chip = watcher.getByRole("button", { name: /^Simulated date/ });
  const startLabel = await chip.getAttribute("aria-label");
  const actor = await session("bureau-head");
  must(await status(actor, "post", "/api/clock/advance", { days: 1 }) === 200, "advance failed");
  const t = performance.now();
  await watcher.waitForFunction((s) => !document.querySelector(`[aria-label="${s}"]`), startLabel, { timeout: 20000 });
  const ms = Math.round(performance.now() - t);
  must(!(await watcher.getByText(/reconnecting/i).count()), "shows a reconnecting state");
  must(watcher.url().endsWith("/"), "page navigated");
  return `updated after ${ms} ms`;
});
await cron("POST", "/api/cron/reset", `Bearer ${CRON}`);

// ================================================================== 9. every page, every role, two widths
const visitId = (await getJson(ui["evc-1"], "/api/dashboard")).visits[0]?.id;
const pages = {
  "off-NR-1": ["/", "/queue", "/applications", `/applications/${ids.atRisk}`, "/evc", "/compliance", "/validity", "/escalations", "/reports", "/audit", "/notifications", "/performance", "/guide"],
  "bureau-head": ["/settings/rules", "/"],
  "inst-AMB": ["/", "/applications", `/applications/${ids.scrutiny}`, "/undertakings", "/documents", "/notifications", "/performance", "/guide"],
  "evc-1": ["/my-cases", ...(visitId ? [`/visits/${visitId}`] : []), "/notifications", "/guide"],
  "sac-1": ["/my-cases", `/cases/${ids.sac}`, "/notifications"],
};
for (const width of [1366, 1024]) {
  await check("9 Pages", `every page for every role at ${width} px: renders, no horizontal scroll`, async () => {
    let n = 0;
    const wide = [];
    for (const [code, paths] of Object.entries(pages)) {
      const p = await session(code, { width, height: 768 });
      for (const url of paths) {
        await go(p, url);
        const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (over > 1) wide.push(`${code} ${url} +${over}px`);
        n += 1;
      }
      await p.context().close();
    }
    const login = await anon({ width, height: 768 });
    await login.goto(`${base}/login`, { waitUntil: "networkidle" });
    must(wide.length === 0, `horizontal scroll: ${wide.join("; ")}`);
    return `${n + 1} pages`;
  });
}

await check("9 Pages", "glass navbar dropdown, Ctrl+K palette, notification popover, avatar menu", async () => {
  await go(off, "/");
  await off.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Cases/ }).click();
  await off.getByRole("menuitem").first().waitFor();
  await off.keyboard.press("Escape");
  await off.locator("main, body").first().click({ position: { x: 5, y: 400 } });
  await off.keyboard.press("Control+k");
  await off.getByRole("dialog", { name: "Search or jump to" }).waitFor();
  await off.keyboard.type("Reports");
  await off.keyboard.press("Enter");
  await off.waitForURL(/\/reports/);
  await off.getByRole("button", { name: /^Notifications/ }).click();
  await off.getByRole("dialog").first().waitFor();
  await off.keyboard.press("Escape");
  await off.getByRole("button", { name: /^Account menu/ }).click();
  await off.getByRole("menuitem", { name: "Switch user" }).waitFor();
  await off.keyboard.press("Escape");
});

await check("9 Pages", "footer note only (no synthetic-data banner), empty states read clearly", async () => {
  await go(off, "/");
  await text(off, "Prototype · all data is synthetic");
  const top = await off.evaluate(() => [...document.querySelectorAll("body *")]
    .filter((e) => { const r = e.getBoundingClientRect(); return e.children.length === 0 && /synthetic/i.test(e.textContent ?? "")
      && r.top < 300 && r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; })
    .map((e) => e.textContent.trim().slice(0, 60)));
  must(top.length === 0, `synthetic wording near the top: ${top.join(" | ")}`);
  await go(off, "/applications");
  await off.getByPlaceholder("Search reference, institution or programme").fill("zz-no-such-case");
  await text(off, "No applications match these filters.");
});

// ================================================================== 10-11. data safety, audit, reset
await check("10 Safety", "no secret value in any response, page source or script", async () => {
  must(secrets.length > 0, "no secrets loaded to compare against");
  for (const url of ["/", "/login", "/api/health", "/api/users/demo", "/api/session", "/api/live"]) {
    const body = await (await fetch(`${base}${url}`)).text();
    scanned += 1;
    if (secrets.some((s) => body.includes(s))) leaks.add(url);
  }
  must(leaks.size === 0, `secret found in: ${[...leaks].join(", ")}`);
  return `${scanned} responses scanned`;
});

await check("10 Safety", "audit chain valid after everything above", async () => {
  const v = await (await off.request.post(`${base}/api/audit/verify`)).json();
  must(v.valid, `chain broken at ${v.broken_at}`);
  return `${v.checked} entries checked`;
});

await check("1 Health", "no 5xx responses during the run", async () => {
  must(serverErrors.length === 0, serverErrors.slice(0, 5).join("; "));
});

await check("9 Pages", "no browser console errors during the run", async () => {
  must(consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
});

await check("11 Reset", "demo restored to a clean state at the end", async () => {
  const r = await cron("POST", "/api/cron/reset", `Bearer ${CRON}`);
  must(r.ok, `HTTP ${r.status}`);
  must((await r.json()).clock.today === "2026-05-15", "clock not reset");
});

for (const c of contexts) await c.close().catch(() => {});
await browser.close();
const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(out, "results.json"), JSON.stringify({ base, at: new Date().toISOString(), timings, results, consoleErrors, serverErrors, retries }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed against ${base}.`);
if (retries.length) console.log(`Network retries: ${retries.join("; ")}`);
if (failed.length) {
  console.log("Failed:");
  for (const f of failed) console.log(` - [${f.section}] ${f.name}: ${f.detail} (${f.screenshot})`);
  process.exit(1);
}
