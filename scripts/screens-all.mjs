// Screenshots of every page for every role at 1366x768 and 1920x1080 (full page).
// Usage: pnpm screens:all <folder>     e.g. pnpm screens:all after   -> screenshots/after/
// Needs `pnpm dev`. Reports console errors and horizontal overflow per page.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const folder = process.argv[2] ?? "all";
const tour = {
  "inst-AMB": ["/", "/applications", "/applications/55", "/undertakings", "/documents", "/notifications", "/performance", "/guide"],
  "off-NR-1": ["/", "/queue", "/applications", "/applications/55", "/evc", "/compliance", "/validity", "/escalations",
    "/reports", "/audit", "/notifications", "/performance", "/guide"],
  "bureau-head": ["/", "/settings/rules", "/escalations"],
  "evc-1": ["/my-cases", "/visits/23"],
  "sac-1": ["/my-cases", "/cases/22"],
};
let failed = false;
for (const [user, pages] of Object.entries(tour)) {
  const r = spawnSync(process.execPath, [path.join(here, "screens.mjs"), user, ...pages],
    { stdio: "inherit", env: { ...process.env, SHOTS_DIR: folder } });
  if (r.status !== 0) failed = true;
}
// the login page
spawnSync(process.execPath, [path.join(here, "screens.mjs"), "inst-AMB", "/login"],
  { stdio: "inherit", env: { ...process.env, SHOTS_DIR: folder } });
process.exit(failed ? 1 : 0);
