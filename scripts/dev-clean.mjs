// Frees ports 3000 (web) and 8000 (API) before `pnpm dev`.
// Stops a listener only if its command line points into this project folder; anything else is
// reported and left running, so you can decide what to do with it.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORTS = [3000, 8000];
const isWin = process.platform === "win32";

function ps(cmd) {
  return execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd], { encoding: "utf8" }).trim();
}

function listeners(port) {
  try {
    if (isWin) {
      const out = ps(`(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique`);
      return out ? out.split(/\s+/).map(Number).filter(Boolean) : [];
    }
    const out = execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
    return out ? out.split(/\s+/).map(Number) : [];
  } catch {
    return [];
  }
}

function commandLine(pid) {
  try {
    if (isWin) return ps(`(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`);
    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

let blocked = false;
for (const port of PORTS) {
  const pids = listeners(port);
  if (!pids.length) {
    console.log(`port ${port}: free`);
    continue;
  }
  for (const pid of pids) {
    // stopping one dev server can stop its sibling (concurrently -k), so re-check first
    if (!listeners(port).includes(pid)) {
      console.log(`port ${port}: free (process ${pid} already exited)`);
      continue;
    }
    const cmd = commandLine(pid);
    const ours = cmd.toLowerCase().includes(root.toLowerCase());
    if (ours) {
      try {
        process.kill(pid);
        console.log(`port ${port}: stopped Argus process ${pid}`);
      } catch (e) {
        blocked = true;
        console.log(`port ${port}: could not stop process ${pid} (${e.code ?? e.message})`);
      }
    } else {
      blocked = true;
      console.log(`port ${port}: held by process ${pid}, not part of this project. Left running:\n    ${cmd || "(command line not readable)"}`);
    }
  }
}
process.exit(blocked ? 1 : 0);
