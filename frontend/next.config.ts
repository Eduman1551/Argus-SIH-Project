import path from "node:path";
import type { NextConfig } from "next";

// In development the FastAPI server runs on :8000 and Next proxies /api to it.
// On Vercel, /api/* is routed to the Python function by vercel.json before Next sees it.
const apiOrigin = process.env.ARGUS_API_ORIGIN ?? "http://127.0.0.1:8000";

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
