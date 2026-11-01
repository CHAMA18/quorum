"use strict";

const vscode = require("vscode");
const path = require("node:path");
const { version } = require("./package.json");

const PROVIDER_ID = "quorumMcp.server";
const SERVER_LABEL = "Quorum MCP";
const DEFAULT_SERVER_URL = "http://127.0.0.1:3031";

function localServerUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid local Quorum MCP URL.");
  }

  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.port !== "3031" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Quorum MCP only accepts a loopback HTTP URL on port 3031, such as http://127.0.0.1:3031.");
  }

  return url.origin;
}

function configuredServerUrl() {
  const setting = vscode.workspace.getConfiguration("quorumMcp").get("serverUrl", DEFAULT_SERVER_URL);
  return localServerUrl(setting);
}

async function configure() {
  await vscode.commands.executeCommand(
    "workbench.action.openSettings",
    "@ext:chama18.quorum-mcp quorumMcp.serverUrl",
  );
}

async function checkConnection() {
  let base;
  try {
    base = configuredServerUrl();
  } catch (error) {
    void vscode.window.showErrorMessage(error.message);
    return;
  }

  try {
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Quorum MCP returned HTTP ${response.status}.`);
    const health = await response.json();
    void vscode.window.showInformationMessage(
      `Quorum MCP is reachable · ${health.counts?.runs ?? 0} runs · ${health.counts?.pendingGates ?? 0} pending gates.`,
    );
  } catch (error) {
    void vscode.window.showErrorMessage(`Cannot reach local Quorum MCP at ${base}: ${error.message}`);
  }
}

function activate(context) {
  const definitionsChanged = new vscode.EventEmitter();
  const provider = vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
    onDidChangeMcpServerDefinitions: definitionsChanged.event,
    provideMcpServerDefinitions: async () => {
      const server = new vscode.McpStdioServerDefinition(
        SERVER_LABEL,
        process.execPath,
        [path.join(context.extensionPath, "server.mjs")],
        {
          ELECTRON_RUN_AS_NODE: "1",
          QUORUM_MCP_URL: configuredServerUrl(),
          QUORUM_MCP_VERSION: version,
        },
        version,
      );
      return [server];
    },
    resolveMcpServerDefinition: async (server) => server,
  });

  context.subscriptions.push(
    definitionsChanged,
    provider,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("quorumMcp.serverUrl")) definitionsChanged.fire();
    }),
    vscode.commands.registerCommand("quorumMcp.configure", configure),
    vscode.commands.registerCommand("quorumMcp.checkConnection", checkConnection),
  );
}

function deactivate() {}

module.exports = { activate, deactivate, localServerUrl };
