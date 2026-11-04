/** One server-owned destination for the procurement service. The browser's
 * XTransformPort=3031 is a logical route selector, never an upstream choice. */
export function sidecarPort(env: Record<string, string | undefined> = process.env): number {
  const value = env.MCP_PORT?.trim() || "3031";
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("MCP_PORT must be a valid local TCP port.");
  return port;
}

export function sidecarOrigin(env: Record<string, string | undefined> = process.env): string {
  const url = new URL(env.QUORUM_SIDECAR_URL?.trim() || `http://127.0.0.1:${sidecarPort(env)}`);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error("QUORUM_SIDECAR_URL must name a local HTTP service origin.");
  }
  return url.origin;
}
