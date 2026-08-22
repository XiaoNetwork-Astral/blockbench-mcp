# Codex Blockbench MCP

在 Blockbench 内提供本地 MCP 建模、检查、贴图、动画和工程操作。

- 直接在 Blockbench 内运行，不依赖 Python 或 Uvicorn。
- MCP 默认仅监听 `127.0.0.1` 并启用 Bearer 认证；用户显式改变监听范围或关闭认证时会收到对应风险警告。
- 已移除任意 JavaScript 执行和通用 UI 自动操作工具。
- 创建、复制和移动节点要求明确父级，并提供多视角空间关系检查。
- “MCP 操作历史”面板按模型保存历史，支持搜索、分页、回滚和重做。
- 可选支持受限目录的 YSM 三标签流程和安装 Hytale 插件后的实验性工具。

完整的安装、连接、设置和工作流说明见源码目录中的 `README.md`。

本插件派生自 Jason J. Gardner 的 `blockbench-mcp-plugin`，继续使用 GPL-3.0-only 许可。
