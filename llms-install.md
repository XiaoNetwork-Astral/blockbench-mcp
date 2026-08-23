# Codex Blockbench MCP 安装与连接

运行 `bun install` 和 `bun run build`，然后在 Blockbench 桌面版中选择“文件 → 插件 → 从文件加载插件”，加载 `dist/codex_blockbench_mcp.js`。文件名不能修改。

默认地址是 `http://127.0.0.1:3000/bb-mcp`，Bearer 认证默认开启。令牌在 Blockbench 的“Codex Blockbench MCP”设置中查看，不要把真实令牌提交到仓库。

## Codex

推荐把令牌放入环境变量：

```toml
[mcp_servers.blockbench]
url = "http://127.0.0.1:3000/bb-mcp"
bearer_token_env_var = "CODEX_BLOCKBENCH_MCP_TOKEN"
```

也可以使用 `http_headers = { Authorization = "Bearer <BLOCKBENCH_MCP_TOKEN>" }`。修改配置后重新启动 Codex 或新建任务。

## 其他客户端

VS Code 可直接使用仓库中的 `.vscode/mcp.json`，连接时会询问令牌。其他客户端请选择 Streamable HTTP，并发送 `Authorization: Bearer <令牌>`。

监听地址、端口、路径、认证或令牌改变后，在 Blockbench 的 Tools 菜单中重启 MCP 服务器，并让客户端重新连接。
