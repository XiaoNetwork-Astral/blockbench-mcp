# Codex Blockbench MCP 安装与连接

本仓库不提供公共插件 URL。请先在仓库中运行 `bun install` 和 `bun run build`，然后在 Blockbench 桌面版中选择“文件 → 插件 → 从文件加载插件”，加载 `dist/codex_blockbench_mcp.js`。文件名必须与插件 ID 保持一致。

插件默认连接地址为 `http://127.0.0.1:3000/bb-mcp`，Bearer 认证默认开启。实际监听地址、端口、端点和令牌以 Blockbench 设置中的“Codex Blockbench MCP”为准；不要把令牌提交到仓库。

## Codex

推荐把令牌放在环境变量中：

```toml
[mcp_servers.blockbench]
url = "http://127.0.0.1:3000/bb-mcp"
bearer_token_env_var = "CODEX_BLOCKBENCH_MCP_TOKEN"
```

也可以临时在本机 `config.toml` 中设置 `http_headers`，但不要提交该配置或复制真实令牌到文档：

```toml
[mcp_servers.blockbench]
url = "http://127.0.0.1:3000/bb-mcp"
http_headers = { Authorization = "Bearer <BLOCKBENCH_MCP_TOKEN>" }
```

Codex 默认会对较大的 MCP 工具目录使用渐进式披露：未在初始上下文中显示的工具仍可通过工具搜索找到。只有在调试完整工具目录时，才在同一配置块中临时加入 `omit_tools_from = ["deferred"]`；日常使用应保留默认行为，避免 114 个核心工具同时挤占上下文。

## VS Code

仓库已经提供 `.vscode/mcp.json`。它会用密码输入框询问令牌，配置等价于：

```json
{
  "servers": {
    "blockbench": {
      "type": "http",
      "url": "http://127.0.0.1:3000/bb-mcp",
      "headers": {
        "Authorization": "Bearer ${input:blockbench-mcp-token}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "blockbench-mcp-token",
      "description": "Bearer token shown in Blockbench MCP settings",
      "password": true
    }
  ]
}
```

## 其他 MCP 客户端

选择 Streamable HTTP 传输，连接上述 URL，并发送 `Authorization: Bearer <令牌>` 请求头。只有用户在插件设置中明确关闭认证后，客户端才能省略该请求头。

修改监听地址、端口、端点、认证状态或令牌后，从 Blockbench 的 Tools 菜单停止并重新启动 MCP 服务器；客户端也需要重新连接。若改用非回环地址，插件会提示局域网暴露风险。

完整设置、安全边界和建模约定见 `README.md`、`AGENTS.md` 与 `CONTRIBUTING.md`。
