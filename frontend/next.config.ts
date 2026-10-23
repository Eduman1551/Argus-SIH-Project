import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// In development the FastAPI server runs on API_PORT (default 8001) and Next proxies /api to it,
// so the browser only ever calls same-origin /api paths (no CORS needed).
// API_PORT comes from the environment (set by scripts/dev.mjs) or the repo's .env, like the API itself.
// On Vercel, /api/* is routed to the Python service by vercel.json before Next sees it.
function apiPort(): string {
  if (process.env.API_PORT) return process.env.API_PORT;
  try {
    const m = readFileSync(path.resolve(__dirname, "..", ".env"), "utf8").match(/^\s*API_PORT\s*=\s*["']?(\d+)/m);
    if (m) return m[1];
  } catch {
    // no .env: use the default
  }
  return "8001";
}

const apiOrigin = process.env.ARGUS_API_ORIGIN ?? `http://127.0.0.1:${apiPort()}`;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  turbopack: { root: path.resolve(__dirname) },
  async rewrites() {
    if (process.env.NODE_ENV === "production" && !process.env.ARGUS_API_ORIGIN) return [];
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
