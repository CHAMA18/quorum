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
/* GitHub Pages serves under /the-bid-box-challenge; a root-hosted static site
   (e.g. a custom domain) sets STATIC_BASE_PATH="" to build without a prefix. */
const staticBasePath = process.env.STATIC_BASE_PATH ?? "/the-bid-box-challenge";

const nextConfig: NextConfig = {
  output: isStatic ? "export" : "standalone",
  ...(isStatic ? { basePath: staticBasePath, images: { unoptimized: true } } : {}),
  /* Public media referenced from plain <video>/<img> tags needs the same
     prefix as the static export's basePath. */
  env: { NEXT_PUBLIC_BASE_PATH: isStatic ? staticBasePath : "" },
  /* Keep standalone output rooted in this app; a parent package-lock.json
     must not nest the server under an unrelated workspace directory. */
  turbopack: { root: process.cwd() },
  /* The tender extractors are Node-only parsers (pdfjs-dist, mammoth,
     read-excel-file) whose bundling trips Turbopack's NFT tracer. Loading them
     from node_modules at runtime keeps the route server-side and the build
     intact; the standalone output copies them. */
  serverExternalPackages: ["unpdf", "pdfjs-dist", "mammoth", "read-excel-file"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  /* Keep the corner clear — the dashboard sidebar lives bottom-left */
  devIndicators: false,
};

export default nextConfig;
