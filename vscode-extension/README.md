# Quorum MCP for VS Code

Quorum MCP adds the local procurement assistant to VS Code Chat as a native MCP
server. It publishes only tools marked `READ` by Quorum; write and filing tools
are filtered out by the stdio bridge.

The bridge connects only to the Quorum sidecar on loopback port `3031`. It does
not send workspace contents or MCP requests to a remote Quorum endpoint.

## Install the packaged extension

From the repository root, install the VSIX with:

```bash
code --install-extension vscode-extension/quorum-mcp-0.2.0.vsix
```

You can also open **Extensions: Install from VSIX…** in VS Code and select that
file.

## Connect Quorum

1. Start Quorum with `bun run dev`. The web app starts the local MCP sidecar on
   `127.0.0.1:3031`.
2. Open the Command Palette and run **Quorum MCP: Check Local Connection**.
3. In VS Code Chat, open **Chat: Open Customizations → MCP Servers** and enable
   **Quorum MCP**.
4. Use the server's read-only tools in an agent chat.

**Quorum MCP: Configure Connection** opens the extension setting
`quorumMcp.serverUrl`. Only `http://127.0.0.1:3031`, `http://localhost:3031`,
and `http://[::1]:3031` are accepted. The extension registers its MCP server
directly with VS Code and does not write a machine-specific path into the
workspace's `.vscode/mcp.json`.

## Build from source

```bash
npm ci
npm run check
npm run package
```

Packaging writes `quorum-mcp-0.2.0.vsix` in this directory. The VSIX contains
the pinned MCP SDK dependency; the Quorum application itself must be running
locally when you use its tools.
