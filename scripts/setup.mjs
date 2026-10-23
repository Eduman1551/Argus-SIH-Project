// One-time setup: Python virtualenv + packages, frontend packages, database tables and seed data.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";

function step(label, cmd, args, opts = {}) {
  console.log(`\n> ${label}`);
  // pnpm and py are scripts/launchers on Windows and need a shell; pass one command string then
  const useShell = opts.shell ?? isWin;
  const r = useShell
    ? spawnSync([cmd, ...args].join(" "), { cwd: root, stdio: "inherit", shell: true })
    : spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`\nFailed: ${label}`);
    process.exit(r.status ?? 1);
  }
}

const venvPython = isWin ? path.join(root, ".venv", "Scripts", "python.exe") : path.join(root, ".venv", "bin", "python");
if (!existsSync(venvPython)) {
  step("Create Python virtualenv", isWin ? "py" : "python3", isWin ? ["-3", "-m", "venv", ".venv"] : ["-m", "venv", ".venv"]);
}
step("Install Python packages", venvPython, ["-m", "pip", "install", "-q", "-r", "requirements-dev.txt"], { shell: false });
step("Install frontend packages", "pnpm", ["--dir", "frontend", "install"]);

if (!existsSync(path.join(root, ".env")) && !process.env.DATABASE_URL) {
  console.log("\nNo .env found. Copy .env.example to .env, set DATABASE_URL, then run `pnpm db:init` and `pnpm db:seed`.");
  process.exit(0);
}
step("Create database tables", venvPython, ["scripts/db.py", "init"], { shell: false });
step("Load synthetic data", venvPython, ["scripts/db.py", "seed"], { shell: false });
console.log("\nSetup done. Start the app with `pnpm dev` and open http://localhost:3000");
