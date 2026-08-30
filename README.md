# Blockbench MCP

A local MCP plugin that runs directly in the Blockbench desktop application. Codex and other MCP clients can use it to read, inspect, and modify the current model without requiring Python, Uvicorn, or an additional bridge process.

This repository is derived from Jason J. Gardner's `blockbench-mcp-plugin` and is not an official release of the upstream project.

## Features

- Modeling, texturing, UVs, animation, materials, projects, and import/export.
- 118 core direct tools and 14 YSM tools; 12 additional experimental tools appear when the Hytale plugin is installed.
- Every tool has an operation-specific schema. There are no grouped `command.action` envelopes.
- Project tools act on the Blockbench tab visible when each call begins. `select_project` is the only way an MCP call chooses another open tab.
- Experimental validation tools provide transformed contact analysis, typed UV checks, project-scoped in-memory snapshots (the latest eight per project), repeatable camera/debug passes, occluder evidence, and native-animation pose sweeps.
- YSM tools configure a folder-scoped workspace, synchronize model extensions, discover JSONC sidecars, inspect and simulate source-backed Molang, render clone-only pose previews, and preview or apply targeted one-file edits.
- Projects can be explicitly made read-only for both the user and MCP while camera navigation and inspection remain available.
- The local MCP server listens on `127.0.0.1` by default and uses Bearer authentication.
- Persistent per-project operation records, Undo/Redo, and Collection organization that does not change the bone hierarchy.

## Build

The development environment requires [Bun](https://bun.sh/):

```powershell
bun install
bun run check
bun run build
```

The installable file is `dist/blockbench_mcp.js`. Use `bun run dev` for a development build.

## Installation

1. In the Blockbench desktop application, open “File → Plugins.”
2. Select “Load Plugin from File.”
3. Load `dist/blockbench_mcp.js`; do not rename the file.
4. If the old instance is still running after an update, restart Blockbench.

See [llms-install.md](llms-install.md) for client connection examples. Run `bun run docs` to generate the API documentation at `docs/index.html`.

## Development Documentation

- [CONTRIBUTING.md](CONTRIBUTING.md): Build instructions, code structure, and commit requirements.
- [AGENTS.md](AGENTS.md): Repository working and Blockbench modeling rules.

## License

The project uses the `GPL-3.0-only` license; see [LICENSE](LICENSE) for details. Attribution to the original author, Jason J. Gardner, is retained. Bundled dependency and compatibility-source notices are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
