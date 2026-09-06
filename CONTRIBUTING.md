# Contributing to Blockbench MCP

The plugin is written in TypeScript and built with Bun. Keep changes focused and verify them at the smallest useful scope.

## Setup

```sh
bun install
bun run check
bun run docs
bun run dev
bun run build
```

`bun run dev:watch` rebuilds on change. For live tests, load `dist/blockbench_mcp.js` from Blockbench's plugin dialog; the filename must not change. MCP Inspector is available through `bun run inspect`.

To preserve an installed artifact, build to a separate directory with `bun ./build/index.ts --outdir <absolute-debug-directory> --minify`. Load that directory's `blockbench_mcp.js` in a separate Blockbench profile. Temporary profiles, logs and helper scripts belong in `.codex/`.

## Layout

- `index.ts`: plugin entry and registration.
- `server/`: MCP server, tools, resources, prompts, and HTTP transport.
- `src/runtime/toolCatalog.ts`: the tool catalog used by both runtime registration and documentation.
- `src/blockbench/`: native painting, animation, controller and element adapters.
- `src/features/validation/`: validation schemas, geometry checks, snapshots and view capture.
- `ui/`: settings, history, project lock, and server controls.
- `lib/`: domain logic, schemas, reference resolution, and Undo handling.
- `prompts/`: bundled prompt sources.
- `tests/`: Bun regression tests.
- `build/`: prompt, documentation, and production builds.

## Tool changes

- Add a focused direct operation to the existing domain module. Do not add command-dispatch wrappers.
- Keep tool names specific and unique; prefer established verbs such as `get`, `list`, `create`, `edit`, `import`, `export`, and `select`.
- Declare whether a tool requires, optionally uses, or does not use the visible project. Set `writableProject: false` only for navigation or metadata operations that must remain available while the explicit lock is active.
- Define schemas without Blockbench globals, validate with Zod, and require an exact UUID when names are ambiguous.
- Creation defaults to the Outliner root, duplication defaults to the original parent, and reparenting requires a destination. Resolve supplied names uniquely; use UUIDs only when names are ambiguous.
- Mutations use bounded Undo edits. Avoid repeated defensive checks and full-project scans when one boundary validation is enough.
- Arbitrary JavaScript execution and generic click, action, or dialog automation are out of scope.
- Define metadata, a Zod object schema and the typed `execute` callback together with `defineTool`. Export the domain's tool array and include it in `src/runtime/toolCatalog.ts`; registration and documentation follow from that catalog. Do not add a second registration function or duplicate schema parsing.
- Use the official MCP server types for resources and prompts. For Blockbench 5.1 animation files, use `AnimationCodec` rather than deprecated `Animator.loadFile` or `Animator.buildFile` methods.

Prompt text belongs in `prompts/*.md`. Run `bun run prompts:build` after changing it; prompts must remain local and must not be fetched from an upstream CDN.

## Verification

- Run `bun run check` for every code change; it runs TypeScript without emitting files and then the complete Bun test suite.
- Run `bun run docs` after changing tools, resources, prompts, or public documentation sources.
- Run `bun run build` when a fresh install artifact is needed.
- Live-test behavior that depends on Blockbench, and check the affected model, Undo/Redo, audit entry, and relevant views.
- Never commit bearer tokens or generated `dist/` files.

## Commits and pull requests

Use conventional commits such as `feat:`, `fix:`, `refactor:`, `docs:`, and `chore:`. Pull requests should state the intent, verification performed, user-visible changes, and any breaking behavior.

Stable releases use Semantic Versioning (MAJOR.MINOR.PATCH), without a fork-specific suffix. Increment MINOR for compatible public MCP features, PATCH for compatible fixes, and MAJOR for incompatible public API or supported-runtime changes. Reserve prerelease suffixes such as -rc.1 for actual preview releases.
