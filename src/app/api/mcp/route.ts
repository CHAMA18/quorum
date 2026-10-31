import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RpcMessage = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: { name?: unknown; [key: string]: unknown };
};

function unauthorized() {
  return NextResponse.json(
    { error: "A valid Quorum MCP gateway credential is required." },
    { status: 401, headers: { "www-authenticate": 'Bearer realm="Quorum MCP"' } },
  );
}

function errorResponse(id: unknown, code: number, message: string, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

function matchesSecret(supplied: string, expected: string) {
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return expectedBytes.length > 0 && suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

async function sidecarRpc(message: RpcMessage) {
  const response = await fetch("http://127.0.0.1:3031/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`MCP sidecar returned HTTP ${response.status}.`);
  return response.json() as Promise<{ result?: { tools?: Array<{ name?: string; description?: string; inputSchema?: Record<string, unknown>; _x_kind?: string }>; [key: string]: unknown }; error?: { code?: number; message?: string } }>;
}

async function handleRpc(message: RpcMessage) {
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return errorResponse(message.id, -32600, "Invalid JSON-RPC request.");
  }

  // Notifications have no id and must not receive a JSON-RPC response.
  if (message.id === undefined && message.method.startsWith("notifications/")) {
    return new Response(null, { status: 202 });
  }

  try {
    if (message.method === "tools/list") {
      const result = await sidecarRpc(message);
      if (result.error) return errorResponse(message.id, result.error.code ?? -32603, result.error.message ?? "MCP request failed.");
      const tools = (result.result?.tools ?? [])
        .filter((tool) => tool._x_kind === "READ")
        .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
      return NextResponse.json({ jsonrpc: "2.0", id: message.id ?? null, result: { tools } });
    }

    if (message.method === "tools/call") {
      const requestedName = typeof message.params?.name === "string" ? message.params.name : "";
      const listing = await sidecarRpc({ jsonrpc: "2.0", id: "quorum-read-tool-check", method: "tools/list" });
      const readTools = (listing.result?.tools ?? []).filter((tool) => tool._x_kind === "READ");
      if (!readTools.some((tool) => tool.name === requestedName)) {
        return errorResponse(message.id, -32601, "This MCP gateway exposes read-only tools; the requested tool is unavailable.");
      }
    }

    if (message.method !== "initialize" && message.method !== "ping" && message.method !== "tools/call") {
      return errorResponse(message.id, -32601, `Unsupported MCP method: ${message.method}`);
    }

    const result = await sidecarRpc(message);
    if (result.error) return errorResponse(message.id, result.error.code ?? -32603, result.error.message ?? "MCP request failed.");
    return NextResponse.json({ jsonrpc: "2.0", id: message.id ?? null, result: result.result ?? {} });
  } catch (error) {
    return errorResponse(message.id, -32603, error instanceof Error ? error.message : "MCP sidecar is unavailable.", 502);
  }
}

/** Private origin hop from Cloudflare; the loopback sidecar is never public. */
export async function POST(request: Request) {
  const edgeSecret = process.env.QUORUM_EDGE_SECRET?.trim() ?? "";
  const suppliedSecret = request.headers.get("x-quorum-edge-key") ?? "";
  if (!matchesSecret(suppliedSecret, edgeSecret)) return unauthorized();

  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 64 * 1024) return NextResponse.json({ error: "MCP request is too large." }, { status: 413 });
  const body = await request.text();
  if (body.length > 64 * 1024) return NextResponse.json({ error: "MCP request is too large." }, { status: 413 });
  let message: RpcMessage;
  try {
    message = JSON.parse(body) as RpcMessage;
  } catch {
    return errorResponse(null, -32700, "Parse error.");
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) return errorResponse(null, -32600, "Invalid JSON-RPC request.");
  return handleRpc(message);
}

export async function GET() {
  return NextResponse.json({ error: "Quorum MCP uses authenticated JSON-RPC POST requests." }, { status: 405, headers: { allow: "POST, OPTIONS" } });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "POST, OPTIONS" } });
}
