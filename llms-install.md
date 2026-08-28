# Blockbench MCP Installation and Connection

Run `bun install` and `bun run build`, then select “File → Plugins → Load Plugin from File” in the Blockbench desktop application and load `dist/blockbench_mcp.js`. Do not rename the file.

The default address is `http://127.0.0.1:3000/bb-mcp`, and Bearer authentication is enabled by default. View the token in Blockbench's “Blockbench MCP” settings. Do not commit a real token to the repository.

## Codex

Storing the token in an environment variable is recommended:

```toml
[mcp_servers.blockbench]
url = "http://127.0.0.1:3000/bb-mcp"
bearer_token_env_var = "BLOCKBENCH_MCP_TOKEN"
```

You can also use `http_headers = { Authorization = "Bearer <BLOCKBENCH_MCP_TOKEN>" }`. Restart Codex or create a new task after changing the configuration.

## Other Clients

VS Code can use the repository's `.vscode/mcp.json` directly and will ask for the token when connecting. For other clients, select Streamable HTTP and send `Authorization: Bearer <token>`.

After changing the bind address, port, path, authentication, or token, restart the MCP server from Blockbench's Tools menu and reconnect the client.
