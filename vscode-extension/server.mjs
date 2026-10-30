import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const baseUrl = process.env.QUORUM_MCP_URL || "http://127.0.0.1:3031";
const allowedHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
const parsedUrl = new URL(baseUrl);
if (
  parsedUrl.protocol !== "http:" ||
  !allowedHosts.has(parsedUrl.hostname) ||
  (parsedUrl.port && parsedUrl.port !== "3031") ||
  parsedUrl.pathname !== "/" ||
  parsedUrl.search ||
  parsedUrl.hash
) {
  throw new Error("Quorum MCP bridge only accepts loopback HTTP URLs on port 3031.");
}

let rpcId = 0;
let readTools;

async function rpc(method, params = {}) {
  const response = await fetch(`${parsedUrl.origin}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Quorum MCP returned HTTP ${response.status}.`);
  const envelope = await response.json();
  if (envelope.error) throw new Error(envelope.error.message || "Quorum MCP request failed.");
  if (!envelope.result) throw new Error("Quorum MCP returned no result.");
  return envelope.result;
}

async function getReadTools() {
  if (readTools) return readTools;
  const result = await rpc("tools/list");
  readTools = (result.tools ?? [])
    .filter((tool) => tool?._x_kind === "READ" && typeof tool.name === "string")
    .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  return readTools;
}

const server = new Server(
  { name: "quorum-mcp-vscode", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: await getReadTools(),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const tools = await getReadTools();
  if (!tools.some((tool) => tool.name === name)) {
    throw new Error(`Tool "${name}" is not available. The VS Code bridge exposes read-only tools only.`);
  }
  return rpc("tools/call", {
    name,
    arguments: request.params.arguments ?? {},
  });
});

server.onerror = (error) => {
  console.error("[quorum-mcp-vscode]", error.message);
};

await server.connect(new StdioServerTransport());
