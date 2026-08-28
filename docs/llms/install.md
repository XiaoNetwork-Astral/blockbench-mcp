## Local Installation and Connection

Run `bun install` and `bun run build`, then load `dist/blockbench_mcp.js` from a file in Blockbench. Do not rename the file.

The default MCP address is `http://127.0.0.1:3000/bb-mcp`, and Bearer authentication is enabled by default. View the token in Blockbench's “Blockbench MCP” settings; the client sends `Authorization: Bearer <token>`.

See the root `llms-install.md` for Codex, VS Code, and other client configuration examples.
