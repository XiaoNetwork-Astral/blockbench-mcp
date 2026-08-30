# Blockbench MCP

在 Blockbench 桌面版中直接运行的本地 MCP 插件。Codex 和其他 MCP 客户端可以用它读取、检查和修改当前模型，不需要 Python、Uvicorn 或额外桥接进程。

本仓库派生自 Jason J. Gardner 的 `blockbench-mcp-plugin`，不是上游项目的官方发行版。

## 功能

- 建模、贴图、UV、动画、材质、工程与导入导出。
- 118 个核心直接工具和 14 个 YSM 工具；安装 Hytale 插件后另有 12 个实验性工具。
- 每个工具直接接收本操作所需的参数，不再使用分组的 `command.action` 封装。
- 涉及项目的工具在调用开始时使用 Blockbench 当前可见的标签页；只有 `select_project` 会选择另一个已打开项目。
- 实验性的模型验证工具支持变换后接触分析、类型化 UV 检查、项目内存快照（每个项目保留最新 8 个）、可复现相机/调试通道、遮挡证据和原生动画姿态扫描。
- YSM 工具支持配置受目录限制的工作区、同步模型扩展、发现 JSONC 边车文件、检查和模拟有源码依据的 Molang、仅作用于克隆的姿态预览，以及预览或应用定点单文件编辑。
- 项目可显式设为对用户和 MCP 均只读，同时仍可进行相机导航和检查。
- 本机 MCP 服务默认监听 `127.0.0.1` 并启用 Bearer 认证。
- 按工程保存的操作记录、Undo/Redo，以及不改变骨骼层级的 Collection 整理。

## 构建

开发环境需要 [Bun](https://bun.sh/)：

```powershell
bun install
bun run check
bun run build
```

可安装文件为 `dist/blockbench_mcp.js`。调试构建使用 `bun run dev`。

## 安装

1. 在 Blockbench 桌面版中打开“文件 → 插件”。
2. 选择“从文件加载插件”。
3. 加载 `dist/blockbench_mcp.js`；不要修改文件名。
4. 更新后如仍运行旧实例，重启 Blockbench。

客户端连接示例见 [llms-install.md](llms-install.md)。运行 `bun run docs` 可生成 API 文档到 `docs/index.html`。

## 开发文档

- [CONTRIBUTING.md](CONTRIBUTING.md)：构建、代码结构和提交要求。
- [AGENTS.md](AGENTS.md)：仓库工作规则与通用 Blockbench 建模规则。

## 许可

项目使用 `GPL-3.0-only`，详见 [LICENSE](LICENSE)。保留原作者 Jason J. Gardner 的署名。随包依赖与兼容性源码声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
