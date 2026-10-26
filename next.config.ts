import type { NextConfig } from "next";

/**
 * Two deploy targets from one codebase:
 *
 * - Default (`bun run build`): the full product — Next server + the
 *   quorum-mcp sidecar (`output: "standalone"`).
 * - `STATIC_EXPORT=1`: GitHub Pages build — static files only, so the
 *   server-side API handlers are excluded by the workflow (moved out of
 *   the tree) and client fetches fall back to their designed idle states.
 *   `basePath` matches Pages project-site hosting.
 */
const isStatic = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  output: isStatic ? "export" : "standalone",
  ...(isStatic ? { basePath: "/the-bid-box-challenge", images: { unoptimized: true } } : {}),
  /* Keep standalone output rooted in this app; a parent package-lock.json
     must not nest the server under an unrelated workspace directory. */
  turbopack: { root: process.cwd() },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  /* Keep the corner clear — the dashboard sidebar lives bottom-left */
  devIndicators: false,
};

export default nextConfig;
