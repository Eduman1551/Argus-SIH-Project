// Runs the project's virtualenv Python with the given arguments.
// Works on Windows (.venv\Scripts\python.exe) and elsewhere (.venv/bin/python).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  path.join(root, ".venv", "Scripts", "python.exe"),
  path.join(root, ".venv", "bin", "python"),
];
const python = candidates.find((p) => existsSync(p));
if (!python) {
  console.error("No virtualenv found. Run `pnpm run setup` first.");
  process.exit(1);
}
const result = spawnSync(python, process.argv.slice(2), { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
