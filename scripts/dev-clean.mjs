// Stops the Argus dev servers: only processes listening on the Argus dev ports (API_PORT and
// WEB_PORT, default 8001 and 3001) whose command line points into this project folder. Anything
// else on those ports is reported and left running. Other projects' ports (e.g. 8000/3000) are
// never touched.
import { execFileSync } from "node:child_process";
import { isArgus, listeners, ports, processInfo } from "./ports.mjs";

const { api, web } = ports();
const isWin = process.platform === "win32";

function stopTree(pid) {
  if (isWin) {
    // /T also stops child processes (Next.js runs its server in a child process)
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    process.kill(pid);
  }
}

let blocked = false;
for (const [port, label] of [[api, "API"], [web, "web"]]) {
  const pids = listeners(port);
  if (!pids.length) {
    console.log(`port ${port} (${label}): free`);
    continue;
  }
  for (const pid of pids) {
    // stopping one dev server can stop its sibling (concurrently -k), so re-check first
    if (!listeners(port).includes(pid)) {
      console.log(`port ${port} (${label}): free (process ${pid} already exited)`);
      continue;
    }
    const info = processInfo(pid);
    if (isArgus(info)) {
      try {
        stopTree(pid);
        console.log(`port ${port} (${label}): stopped Argus ${info.name} (PID ${pid})`);
      } catch (e) {
        blocked = true;
        console.log(`port ${port} (${label}): could not stop ${info.name} (PID ${pid}): ${e.message}`);
      }
    } else {
      blocked = true;
      console.log(`port ${port} (${label}): held by ${info.name || "a process"} (PID ${pid}), which is not part of Argus. Left running.`);
      console.log(`    Close it yourself, or set ${label === "API" ? "API_PORT" : "WEB_PORT"}=<free port> in .env.`);
    }
  }
}
process.exit(blocked ? 1 : 0);
