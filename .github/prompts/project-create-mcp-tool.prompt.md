---
mode: agent
description: Add a dedicated, schema-validated MCP tool without weakening the repository's modeling or security boundaries.
tools: ['githubRepo', 'get_commit', 'get_file_contents', 'list_branches', 'search_code', 'search_repositories', 'blockbench']
---

# Create a Blockbench MCP Tool

Read `AGENTS.md` for the modeling contract and `CONTRIBUTING.md` for repository structure before changing code. Implement the requested capability as a narrow, dedicated MCP tool. Arbitrary JavaScript evaluation and generic UI action/click/dialog automation are intentionally unavailable and must not be reintroduced.

The plugin is written in TypeScript, built with Bun, and runs inside Blockbench's Electron environment. Tool schemas must remain importable outside Blockbench because the documentation generator loads them without editor globals.

When the local source and types are insufficient, consult the current Blockbench source (`JannisX11/blockbench`), plugin repository, and official MCP SDK documentation. Prefer existing local helpers and patterns over copying upstream code blindly.

## Request

${input:chatPrompt}

## Requirements

- First confirm that a dedicated tool does not already provide the capability.
- Define a module-level `ToolSpec` and Zod schema with no Blockbench runtime globals, then register the implementation through the shared factory.
- Mutations must validate every reference before editing, use deterministic UUID/name resolution, respect protected project roles, record audit data, and capture complete Undo before/after state.
- Creation, duplication, movement, or reparenting must require an explicit parent. Only the literal `root` intentionally targets the root; missing or ambiguous references must fail before mutation.
- Geometry-related tools must return enough identifiers and spatial data for front/side/top/three-quarter verification. If semantics remain uncertain, leave a safe checkpoint for human inspection.
- Add the tool to the registry and documentation manifest, then add focused regression tests for schema, error, Undo, and safety behavior.
- Run `bun run check` and `bun run docs`. Build or load the plugin only when the user explicitly authorizes replacing the current artifact.

Do not alter unrelated model files, running Blockbench state, or generated plugin artifacts while another live test depends on them.
