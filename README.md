# Blockbench MCP

A local MCP plugin that runs directly in the Blockbench desktop application. Codex and other MCP clients can use it to read, inspect, and modify the current model without requiring Python, Uvicorn, or an additional bridge process.

This repository is derived from Jason J. Gardner's `blockbench-mcp-plugin` and is not an official release of the upstream project.

## Features

- Modeling, texturing, UVs, animation, materials, projects, and import/export.
- 36 core tools; three YSM tools are added after configuring the plugin workspace, and two experimental tools are added when the Hytale plugin is installed.
- Tools are grouped by domain and read/write boundaries, with public names consistently using `inspect_*`, `edit_*`, `create_*`, `import_*`, and `export_*`.
- Each MCP session binds to its working project independently; background modeling and offscreen screenshots do not switch away from the tab the user is viewing.
- Projects can be explicitly made read-only for everyone, or unsaved content can be discarded and the project closed within an explicitly defined scope.
- The local MCP server listens on `127.0.0.1` by default and uses Bearer authentication.
- Per-project operation records, Undo/Redo, and Collection organization that does not change the bone hierarchy.

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
- [AGENTS.md](AGENTS.md): General Blockbench modeling rules.

## License

The project uses the `GPL-3.0-only` license; see [LICENSE](LICENSE) for details. Attribution to the original author, Jason J. Gardner, is retained.
