// Restore the deployed demo to its clean seeded state (data, clock and audit log) before a demo.
// Usage: pnpm reset:live [https://your-app.vercel.app]   (default: ARGUS_URL, then the local web port)
// Calls POST /api/cron/reset with CRON_SECRET from the environment or .env. The secret is never printed.
import { readFileSync } from "node:fs";
import path from "node:path";
import { root, webUrl } from "./ports.mjs";

function secret() {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET;
  try {
    const m = readFileSync(path.join(root, ".env"), "utf8").match(/^\s*CRON_SECRET\s*=\s*["']?([^"'\r\n]+)/m);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

const base = (process.argv[2] ?? webUrl()).replace(/\/+$/, "");
const key = secret();
if (!key) {
  console.error("CRON_SECRET is not set (environment or .env).");
  process.exit(1);
}
const res = await fetch(`${base}/api/cron/reset`, { method: "POST", headers: { Authorization: `Bearer ${key}` } });
if (!res.ok) {
  console.error(`Reset failed: HTTP ${res.status} from ${base}`);
  process.exit(1);
}
const body = await res.json();
console.log(`Demo data restored on ${base}. Simulated date: ${body.clock.today}.`);
