# Contributing to Codex Blockbench MCP

Thank you for improving the Blockbench MCP plugin. This project uses TypeScript and Bun. Please keep changes focused, documented, and easy to verify inside Blockbench.

## Prerequisites

- Bun installed: https://bun.sh/
- Blockbench desktop for live integration testing.

## Setup & Development
```sh
bun install                # install deps
bun run check              # automated regression suite; does not write dist/
bun run docs               # regenerate prompt manifest and API docs
bun run dev                # build once with sourcemaps
bun run dev:watch          # rebuild on change (watch mode)
bun run build              # minified production build to dist/codex_blockbench_mcp.js
```

For MCP Inspector (optional):
```sh
bunx @modelcontextprotocol/inspector
```
The default server URL is `http://127.0.0.1:3000/bb-mcp`. Bearer authentication is enabled by default; obtain the token from Blockbench settings and never commit it.

For live testing, use File → Plugins → Load Plugin from File and select `dist/codex_blockbench_mcp.js`. The filename is part of the local Blockbench plugin identity and must not be changed.

## Project Structure
- `index.ts`: Plugin entry; registers server, UI, settings.
- `server/`: MCP server implementation.
  - `server.ts`: McpServer singleton (official MCP SDK).
  - `tools.ts`: Tool module aggregator importing domain-specific tools.
  - `tools/`: Tool implementations by domain, including guarded modeling, audit/history, spatial inspection, YSM workflow, and optional Hytale support.
  - `resources.ts`: MCP resource definitions.
  - `prompts.ts`: MCP prompts with argument schemas.
  - `net.ts`: HTTP server and transport handling.
- `ui/`: Operations history, settings, server controls, client management, and status UI.
- `lib/`: Shared factories, security guards, deterministic reference resolution, Undo safety, sessions, workspace controls, and Zod schemas.
- `prompts/`: Prompt source files bundled through `prompts/manifest.json`.
- `tests/`: Bun regression tests.
- `dist/`: Ignored build outputs, including `codex_blockbench_mcp.js`.

## Adding Tools
Use `createTool()` from `lib/factories.ts`. Tools are organized by domain in `server/tools/` (e.g., `animation.ts`, `paint.ts`, `mesh.ts`). Each domain file exports a registration function that is called from `server/tools.ts`.

Example tool in a domain file (e.g., `server/tools/example.ts`):
```ts
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";

export const exampleParameters = z.object({ name: z.string() });
export const exampleToolDocs: ToolSpec[] = [{
  name: "example",
  description: "Does something useful",
  annotations: { title: "Example", readOnlyHint: true },
  parameters: exampleParameters,
  status: "stable",
}];

export function registerExampleTools() {
  createTool(exampleToolDocs[0].name, {
    ...exampleToolDocs[0],
    async execute({ name }) {
      return `Hello, ${name}!`;
    },
  }, exampleToolDocs[0].status);
}
```
Then import and call the registration function in `server/tools.ts`, add the docs array to `build/docs-manifest.ts`, and add regression coverage.

- Naming: Tools are registered with the name you provide (no automatic prefix).
- Define schemas without Blockbench globals because docs/tests import them outside Blockbench.
- Validate inputs with Zod and resolve names deterministically; duplicate names must require an exact UUID.
- Creation, duplication, and reparenting tools must require an explicit parent. Only the exact literal `"root"` may intentionally select root.
- Mutations must use bounded Undo edits and remain compatible with the shared project-role guard and audit wrapper.
- Arbitrary JavaScript execution and generic action/click/dialog automation are permanently out of scope.

## Adding Resources
Use `createResource()` from `lib/factories.ts` in `server/resources.ts`:
```ts
import { createResource } from "@/lib/factories";

createResource("example", {
  uriTemplate: "example://{id}",
  title: "Example Resource",
  description: "Description of the resource",
  async listCallback() {
    // Return list of available resources
    return { resources: [{ uri: "example://1", name: "Item 1" }] };
  },
  async readCallback(uri, { id }) {
    // Return resource content
    return { contents: [{ uri: uri.href, text: JSON.stringify({ id }) }] };
  },
});
```
See existing `projects`, `nodes`, and `textures` examples in `server/resources.ts`.

## Adding Prompts
Use `createPrompt()` from `lib/factories.ts` in `server/prompts.ts`:
```ts
import { z } from "zod";
import { createPrompt } from "@/lib/factories";

createPrompt("example_prompt", {
  description: "Description of the prompt",
  argsSchema: z.object({
    option: z.enum(["a", "b"]).optional(),
  }),
  async generate({ option }) {
    return {
      messages: [{ role: "user", content: { type: "text", text: `Selected: ${option}` } }],
    };
  },
});
```
Prompt text belongs in `prompts/*.md`. Run `bun run prompts:build` to update the bundled manifest; never fetch private-fork prompt behavior from an upstream CDN.

## Safety invariants

- The normal server binds to `127.0.0.1` and requires a bearer token by default. Changes to network exposure or authentication require explicit UI warnings and tests.
- Every session server must receive the same enabled tools, resources, and prompts through the reconstruction functions in `lib/factories.ts`.
- Read-only/reference projects remain protected even if a tool omits metadata; missing `readOnlyHint` is treated as potentially mutating.
- Never reintroduce a general evaluation or UI-automation escape hatch to work around a missing dedicated tool.
- Keep `AGENTS.md`, bundled model-creation prompts, tool schemas, and implementation behavior aligned on hierarchy, multi-view checks, and human review checkpoints.

## Style & Commits
- TypeScript strict mode; ESNext modules; use the `@/*` path alias.
- 2-space indentation; explicit return types where reasonable.
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`. Be specific.

## Pull Requests
- Describe scope and intent, link related issues.
- Add repro and verification steps; include screenshots/GIFs for UI changes.
- Call out new tools, resources, settings, or breaking changes.

## Verification Checklist

- Automated checks: run `bun run check`.
- Generated files: run `bun run docs` and confirm the core catalog contains 108 tools plus 12 optional Hytale tools.
- Build: run `bun run build` only when a fresh install artifact is actually needed; confirm `dist/codex_blockbench_mcp.js` is produced and remains untracked.
- Load: In Blockbench → File → Plugins → Load Plugin from File → pick `dist/codex_blockbench_mcp.js`.
- Settings: Confirm bind host, port, endpoint, authentication, token, audit, and workspace controls.
- Server: Use Tools → Show Server Status and Manage Clients; verify client/session accounting and authentication behavior.
- Tools: Through MCP Inspector or another client, call the smallest representative payload and verify result, Outliner state, explicit parent, audit entry, Undo and Redo.
- Resources: In Inspector, resolve a sample URI (e.g., `nodes://<id>` or `textures://<name>`); confirm autocompletion and returned data.
- Prompts: Load the prompt; check argument autocompletion and that `load` returns content without errors.
- UI: Check operations history, server controls, client manager, and light/dark presentation.
- Spatial/modeling changes: inspect front, side, top, and three-quarter views; ask the user to inspect when semantic placement cannot be established reliably.
