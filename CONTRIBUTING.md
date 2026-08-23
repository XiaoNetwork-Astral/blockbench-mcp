# Contributing to Codex Blockbench MCP

The plugin is written in TypeScript and built with Bun. Keep changes focused and verify them at the smallest useful scope.

## Setup

```sh
bun install
bun run check
bun run docs
bun run dev
bun run build
```

`bun run dev:watch` rebuilds on change. For live tests, load `dist/codex_blockbench_mcp.js` from Blockbench's plugin dialog; the filename must not change. MCP Inspector is available through `bun run inspect`.

## Layout

- `index.ts`: plugin entry and registration.
- `server/`: MCP server, tools, resources, prompts, and HTTP transport.
- `ui/`: settings, history, server controls, and client management.
- `lib/`: shared schemas, guards, reference resolution, Undo handling, and sessions.
- `prompts/`: bundled prompt sources.
- `tests/`: Bun regression tests.
- `build/`: prompt, documentation, and production builds.

## Tool changes

- Add related operations to an existing domain group when possible. Grouped operations use a precise `command.action` schema.
- Public names follow `<intent>_<domain>[_<facet>]`: `inspect_*`, `edit_*`, `create_*`, `import_*`, or `export_*`. Internal action names must remain unique.
- Keep reads and mutations in separate public groups. The group annotation controls project-role checks, audit behavior, and failure cleanup.
- Define schemas without Blockbench globals, validate with Zod, and require an exact UUID when names are ambiguous.
- Creation, duplication, and reparenting require an explicit parent; only literal `root` selects the root.
- Mutations use bounded Undo edits. Avoid repeated defensive checks and full-project scans when one boundary validation is enough.
- Arbitrary JavaScript execution and generic click, action, or dialog automation are out of scope.
- Register tool docs in `build/docs-manifest.ts` and add regression coverage. Follow existing `createInternalTool`, `createToolGroup`, `createTool`, `createResource`, and `createPrompt` examples.

Prompt text belongs in `prompts/*.md`. Run `bun run prompts:build` after changing it; prompts must remain local and must not be fetched from an upstream CDN.

## Verification

- Run `bun run check` for every code change.
- Run `bun run docs` after changing tools, resources, prompts, or public documentation sources.
- Run `bun run build` when a fresh install artifact is needed.
- Live-test behavior that depends on Blockbench, and check the affected model, Undo/Redo, audit entry, and relevant views.
- Never commit bearer tokens or generated `dist/` files.

## Commits and pull requests

Use conventional commits such as `feat:`, `fix:`, `refactor:`, `docs:`, and `chore:`. Pull requests should state the intent, verification performed, user-visible changes, and any breaking behavior.
