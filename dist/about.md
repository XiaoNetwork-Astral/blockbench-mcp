# Codex Blockbench MCP

YSM 模型制作使用的本地私用插件。

- 直接在 Blockbench 内运行，不依赖 Python 或 Uvicorn。
- MCP 仅监听 `127.0.0.1`，所有请求必须携带设置中生成的 Bearer 令牌。
- 已移除任意 JavaScript 执行和通用 UI 自动操作工具。
- “Codex 操作记录”面板按模型保存历史，支持搜索、分页、回滚和重做。
- 支持“旧版参照 / 新版基线 / 工作副本”三标签工作流，前两个标签受到只读保护。

完整的安装、连接、设置和工作流说明见源码目录中的 `README.md`。

本插件派生自 Jason J. Gardner 的 `blockbench-mcp-plugin`，继续使用 GPL-3.0-only 许可。
