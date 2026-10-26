/**
 * Next.js instrumentation — runs once when the server boots.
 *
 * Spawns the quorum-mcp sidecar (port 3031) from the long-lived server
 * process so the live agent stack — MCP surface, audit log, human gate —
 * is always reachable for the demo, without a second terminal.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as { __quorumMcpBooted?: boolean };
  if (g.__quorumMcpBooted) return;
  g.__quorumMcpBooted = true;

  const { ensureMcpSidecar } = await import("@/lib/mcp-boot");
  const result = await ensureMcpSidecar();
  if (result !== "running") {
    console.log(`[mcp-boot] quorum-mcp sidecar: ${result}`);
  }
}
