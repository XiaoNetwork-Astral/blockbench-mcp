# Blockbench MCP

A local MCP plugin that runs inside the Blockbench desktop application and provides tools for modeling, texturing, UVs, animation, project management, and import/export.

By default, it listens only on `127.0.0.1` and uses Bearer authentication. The catalog contains 118 core direct tools and 14 YSM tools, with 12 additional Hytale tools when that plugin is installed. Project tools use the visible Blockbench tab; there is no connection-owned or background project. Experimental actions cover reproducible contact/UV/camera/pose validation, while YSM support includes source-backed Molang inspection, simulation, clone-only preview, and targeted JSONC editing.

This project is derived from Jason J. Gardner's `blockbench-mcp-plugin` and uses the GPL-3.0-only license.
