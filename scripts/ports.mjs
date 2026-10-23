// Argus dev ports, in one place. Defaults: API 8001, web 3001 (so Argus can run next to other
// projects that use 8000/3000). Override with API_PORT / WEB_PORT in the environment or in .env;
// the web proxy (frontend/next.config.ts) reads the same API_PORT.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULTS = { API_PORT: 8001, WEB_PORT: 3001 };
const isWin = process.platform === "win32";

/** Only the port settings are read from .env; nothing else is loaded or printed. */
function fromDotenv(key) {
  try {
    const text = readFileSync(path.join(root, ".env"), "utf8");
    const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*["']?(\\d+)`, "m"));
    return m ? m[1] : undefined;
  } catch {
    return undefined;
  }
}

function portSetting(key) {
  const raw = process.env[key] ?? fromDotenv(key) ?? String(DEFAULTS[key]);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) {
    console.error(`${key} must be a whole number between 1024 and 65535.`);
    process.exit(1);
  }
  return n;
}

export function ports() {
  return { api: portSetting("API_PORT"), web: portSetting("WEB_PORT") };
}

export function webUrl() {
  return process.env.ARGUS_URL ?? `http://localhost:${ports().web}`;
}

function ps(cmd) {
  return execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd], { encoding: "utf8" }).trim();
}

/** PIDs listening on a TCP port (any address). */
export function listeners(port) {
  try {
    if (isWin) {
      const out = ps(`(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique`);
      return out ? out.split(/\s+/).map(Number).filter(Boolean) : [];
    }
    const out = execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
    return out ? [...new Set(out.split(/\s+/).map(Number))] : [];
  } catch {
    return [];
  }
}

/** { name, cmd } of a process; empty strings if it is gone or not readable. */
export function processInfo(pid) {
  try {
    if (isWin) {
      const out = ps(`$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { $p.Name; $p.CommandLine }`);
      const [name = "", ...rest] = out.split(/\r?\n/);
      return { name: name.trim(), cmd: rest.join(" ").trim() };
    }
    const name = execFileSync("ps", ["-o", "comm=", "-p", String(pid)], { encoding: "utf8" }).trim();
    const cmd = execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim();
    return { name: path.basename(name), cmd };
  } catch {
    return { name: "", cmd: "" };
  }
}

/** True if the process command line points into this project folder (an Argus dev server). */
export function isArgus(info) {
  return info.cmd.toLowerCase().includes(root.toLowerCase());
}
