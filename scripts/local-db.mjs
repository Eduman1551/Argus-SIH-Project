// Starts a project-local PostgreSQL cluster in .pgdata on port 5433 (trust auth,
// local connections only), so development works without knowing the postgres password.
// Needs the PostgreSQL bin folder (initdb, pg_ctl, psql) on PATH.
// Usage: pnpm db:local        -> init (first time) and start
//        pnpm db:local stop   -> stop the cluster
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, ".pgdata");
const port = "5433";

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.error) {
    console.error(`Could not run ${cmd}. Is the PostgreSQL bin folder on PATH?`);
    process.exit(1);
  }
  return r.status ?? 1;
}

if (process.argv[2] === "stop") {
  process.exit(run("pg_ctl", ["-D", dataDir, "stop", "-m", "fast"]));
}

if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
  console.log("Creating local cluster in .pgdata ...");
  const s = run("initdb", ["-D", dataDir, "-U", "argus", "--auth=trust", "-E", "UTF8", "--locale=C"]);
  if (s !== 0) process.exit(s);
}

const status = spawnSync("pg_ctl", ["-D", dataDir, "status"], { stdio: "ignore" });
if (status.status !== 0) {
  // stdio must be ignored here: the server process inherits our handles on Windows,
  // and inherited pipes would keep this script from exiting.
  const s = run("pg_ctl", [
    "-D", dataDir, "-l", path.join(dataDir, "server.log"),
    "-o", `-p ${port} -c listen_addresses=localhost`, "-w", "start",
  ], { stdio: "ignore" });
  if (s !== 0) {
    console.error("pg_ctl start failed, see .pgdata/server.log");
    process.exit(s);
  }
}

const exists = spawnSync(
  "psql",
  ["-h", "localhost", "-p", port, "-U", "argus", "-d", "postgres", "-tAc", "select 1 from pg_database where datname='argus'"],
  { encoding: "utf8" },
);
if (!String(exists.stdout).includes("1")) {
  run("psql", ["-h", "localhost", "-p", port, "-U", "argus", "-d", "postgres", "-c", "create database argus"]);
}
console.log(`Local Postgres is running. Use DATABASE_URL=postgresql://argus@localhost:${port}/argus`);
