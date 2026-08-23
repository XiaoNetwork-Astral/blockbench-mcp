# Codex Blockbench MCP

在 Blockbench 桌面版中直接运行的本地 MCP 插件。Codex 和其他 MCP 客户端可以用它读取、检查和修改当前模型，不需要 Python、Uvicorn 或额外桥接进程。

本仓库派生自 Jason J. Gardner 的 `blockbench-mcp-plugin`，不是上游项目的官方发行版。

## 功能

- 建模、贴图、UV、动画、材质、工程与导入导出。
- 41 个核心工具；安装 Hytale 插件后另有 2 个实验性工具。
- 工具按领域和读写边界分组，公开名统一使用 `inspect_*`、`edit_*`、`create_*`、`import_*` 和 `export_*`。
- 本机 MCP 服务默认监听 `127.0.0.1` 并启用 Bearer 认证。
- 按工程保存的操作记录、Undo/Redo，以及可选的 YSM 三标签工作流。

## 构建

开发环境需要 [Bun](https://bun.sh/)：

```powershell
bun install
bun run check
bun run build
```

可安装文件为 `dist/codex_blockbench_mcp.js`。调试构建使用 `bun run dev`。

## 安装

1. 在 Blockbench 桌面版中打开“文件 → 插件”。
2. 选择“从文件加载插件”。
3. 加载 `dist/codex_blockbench_mcp.js`；不要修改文件名。
4. 更新后如仍运行旧实例，重启 Blockbench。

客户端连接示例见 [llms-install.md](llms-install.md)。运行 `bun run docs` 可生成 API 文档到 `docs/index.html`。

## 开发文档

- [CONTRIBUTING.md](CONTRIBUTING.md)：构建、代码结构和提交要求。
- [AGENTS.md](AGENTS.md)：通用 Blockbench 建模规则。

## 许可

项目使用 `GPL-3.0-only`，详见 [LICENSE](LICENSE)。保留原作者 Jason J. Gardner 的署名。
