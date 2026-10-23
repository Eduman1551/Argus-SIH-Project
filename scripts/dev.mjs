// Dev launcher for Argus. Ports come from scripts/ports.mjs (API_PORT / WEB_PORT, default 8001 / 3001).
//   node scripts/dev.mjs check         -> fail with a clear message if a dev port is busy
//   node scripts/dev.mjs api [--reload] -> FastAPI on 127.0.0.1:API_PORT
//   node scripts/dev.mjs web           -> Next.js dev server on WEB_PORT (proxies /api to API_PORT)
//   node scripts/dev.mjs web:start     -> Next.js production server on WEB_PORT (after `pnpm build`)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { isArgus, listeners, ports, processInfo, root } from "./ports.mjs";

const [mode = "check", ...flags] = process.argv.slice(2);
const { api, web } = ports();
const env = { ...process.env, API_PORT: String(api), WEB_PORT: String(web) };

function check() {
  const busy = [];
  for (const [port, label, key] of [[api, "Argus API", "API_PORT"], [web, "Argus web", "WEB_PORT"]]) {
    for (const pid of listeners(port)) {
      const info = processInfo(pid);
      busy.push({ port, label, key, pid, info });
    }
  }
  if (!busy.length) {
    console.log(`Ports free: API ${api}, web ${web}.`);
    return true;
  }
  for (const b of busy) {
    const who = `${b.info.name || "unknown process"} (PID ${b.pid})`;
    console.error(`\nPort ${b.port} (${b.label}) is already in use by ${who}.`);
    if (isArgus(b.info)) {
      console.error("  It is an Argus dev server that is still running. Stop it with:  pnpm dev:clean");
    } else {
      console.error("  It is not part of Argus. Either close that program, or give Argus another port by");
      console.error(`  adding ${b.key}=<free port> to .env (the web proxy follows API_PORT automatically).`);
    }
  }
  console.error("");
  return false;
}

function run(cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, env, stdio: "inherit" });
  const stop = () => { if (!child.killed) child.kill(); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => process.exit(code ?? 0));
}

if (mode === "check") {
  process.exit(check() ? 0 : 1);
} else if (mode === "api") {
  const python = [path.join(root, ".venv", "Scripts", "python.exe"), path.join(root, ".venv", "bin", "python")].find(existsSync);
  if (!python) {
    console.error("No virtualenv found. Run `pnpm run setup` first.");
    process.exit(1);
  }
  const args = ["-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "127.0.0.1", "--port", String(api)];
  if (flags.includes("--reload")) args.push("--reload", "--reload-dir", "backend");
  console.log(`Argus API on http://localhost:${api}  (health: http://localhost:${api}/api/health)`);
  run(python, args, root);
} else if (mode === "web" || mode === "web:start") {
  const frontend = path.join(root, "frontend");
  const nextBin = path.join(frontend, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextBin)) {
    console.error("Frontend packages are missing. Run `pnpm run setup` first.");
    process.exit(1);
  }
  console.log(`Argus web on http://localhost:${web}  (proxying /api to port ${api})`);
  run(process.execPath, [nextBin, mode === "web" ? "dev" : "start", "--port", String(web)], frontend);
} else {
  console.error(`Unknown mode "${mode}". Use check, api, web or web:start.`);
  process.exit(2);
}
