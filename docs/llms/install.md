## 本地安装与连接

本仓库不公开部署插件 URL。运行 `bun install` 与 `bun run build` 后，在 Blockbench 中从文件加载 `dist/codex_blockbench_mcp.js`；文件名必须保持不变。

默认 MCP 地址是 `http://127.0.0.1:3000/bb-mcp`，Bearer 认证默认开启。请从 Blockbench 的“Codex Blockbench MCP”设置中取得当前令牌，并在客户端中发送 `Authorization: Bearer <令牌>`。不要把真实令牌写入仓库。

Codex 的推荐配置使用 `bearer_token_env_var`。大工具目录默认采用渐进式披露；只有调试完整目录时才临时设置 `omit_tools_from = ["deferred"]`。完整示例见根目录的 `llms-install.md` 和 `README.md`。
