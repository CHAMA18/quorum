# Quorum MCP for VS Code

The extension connects VS Code Chat to the local Quorum MCP sidecar. It exposes
only tools the Quorum server marks `READ`; writes and irreversible actions are
not available from this bridge.

## Install for development

1. Open this repository in VS Code.
2. Open `vscode-extension/` as an extension development host, or install the
   packaged extension when a `.vsix` is available.
3. Start Quorum (`bun run dev`). Its MCP sidecar normally starts with the web
   app on `127.0.0.1:3031`.
4. Run **Quorum MCP: Check Local Connection** from the Command Palette.
5. Run **Quorum MCP: Configure Read-only Server**. This adds or updates only
   `servers.quorumMcp` in the workspace `.vscode/mcp.json` and preserves other
   JSONC entries.
6. In VS Code Chat, reload MCP servers if prompted and enable **quorumMcp**.
   Ask questions about runs, deadlines, committee status, or tender records.

The extension defaults to `http://127.0.0.1:3031`. A different host, HTTPS
endpoint, or port is intentionally refused: this bridge is for the local
sidecar and does not transmit workspace data to a remote MCP service.

## Package

From this directory, run `npm install`, then package the extension with
`npx @vscode/vsce package`. The generated `.vsix` is local build output and
should be reviewed before distribution.
