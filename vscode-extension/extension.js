const vscode = require("vscode");
const fs = require("node:fs/promises");
const path = require("node:path");
const { applyEdits, modify, parse, printParseErrorCode } = require("jsonc-parser");

const MCP_CONFIG = [".vscode", "mcp.json"];
const SERVER_KEY = "quorumMcp";

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
    (url.port && url.port !== "3031") ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Quorum MCP must use a loopback URL on port 3031, for example http://127.0.0.1:3031.");
  }
  return url.origin;
}

function reportParseErrors(errors) {
  if (!errors.length) return;
  const first = errors[0];
  throw new Error(`Could not safely update mcp.json: ${printParseErrorCode(first.error)}. No changes were written.`);
}

async function configure(context) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage("Open a workspace folder before configuring Quorum MCP.");
    return;
  }

  const settings = vscode.workspace.getConfiguration("quorumMcp", folder.uri);
  let configuredUrl;
  try {
    configuredUrl = localServerUrl(settings.get("serverUrl", "http://127.0.0.1:3031"));
  } catch (error) {
    void vscode.window.showErrorMessage(error.message);
    return;
  }
  const configUri = vscode.Uri.joinPath(folder.uri, ...MCP_CONFIG);
  const configPath = configUri.fsPath;
  let source = "";
  try {
    source = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      void vscode.window.showErrorMessage(`Could not read ${path.join(...MCP_CONFIG)}: ${error.message}`);
      return;
    }
  }

  const errors = [];
  const config = source.trim() ? parse(source, errors, { allowTrailingComma: true, disallowComments: false }) : {};
  try {
    reportParseErrors(errors);
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("The existing mcp.json root must be a JSON object. No changes were written.");
    }

    const bridgePath = path.join(context.extensionPath, "server.mjs");
    const server = {
      type: "stdio",
      command: "node",
      args: [bridgePath],
      env: { QUORUM_MCP_URL: configuredUrl },
    };
    const withServersEdits = modify(source || "{}", ["servers"], config.servers ?? {}, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    });
    const withServers = applyEdits(source || "{}", withServersEdits);
    const serverEdits = modify(withServers, ["servers", SERVER_KEY], server, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    });
    const updated = applyEdits(withServers, serverEdits);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, updated, "utf8");
    const document = await vscode.workspace.openTextDocument(configUri);
    await vscode.window.showTextDocument(document);
    void vscode.window.showInformationMessage(
      "Quorum MCP is configured with read-only tools. Start the local Quorum app, then reload MCP servers in VS Code Chat.",
    );
  } catch (error) {
    void vscode.window.showErrorMessage(error.message);
  }
}

async function checkConnection() {
  const settings = vscode.workspace.getConfiguration("quorumMcp");
  let base;
  try {
    base = localServerUrl(settings.get("serverUrl", "http://127.0.0.1:3031"));
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
  context.subscriptions.push(
    vscode.commands.registerCommand("quorumMcp.configure", () => configure(context)),
    vscode.commands.registerCommand("quorumMcp.checkConnection", checkConnection),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
