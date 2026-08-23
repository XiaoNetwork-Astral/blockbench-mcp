## 本地安装与连接

运行 `bun install` 和 `bun run build`，然后在 Blockbench 中从文件加载 `dist/codex_blockbench_mcp.js`。文件名不能修改。

默认 MCP 地址是 `http://127.0.0.1:3000/bb-mcp`，Bearer 认证默认开启。令牌在 Blockbench 的“Codex Blockbench MCP”设置中查看；客户端发送 `Authorization: Bearer <令牌>`。

Codex、VS Code 和其他客户端的配置示例见根目录 `llms-install.md`。
