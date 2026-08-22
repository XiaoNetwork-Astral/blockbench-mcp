---
mode: agent
description: Verify a Blockbench MCP tool through static checks, focused tests, and authorized live inspection.
tools: ['changes', 'codebase', 'fetch', 'problems', 'runCommands', 'search', 'searchResults', 'terminalLastCommand', 'terminalSelection', 'usages', 'search_code', 'search_repositories', 'blockbench', 'websearch']
---

# Test a Blockbench MCP Tool

Read `AGENTS.md` and `CONTRIBUTING.md`, then test the requested tool without bypassing its public MCP schema. Arbitrary JavaScript evaluation and generic UI automation are disabled security boundaries, not debugging fallbacks.

## Test request

${input:chatPrompt}

## Verification order

1. Inspect the implementation and its `ToolSpec`; verify required fields, annotations, exact parent semantics, deterministic lookup, protection checks, and Undo coverage.
2. Run focused tests, followed by `bun run check`. Regenerate docs when schemas or manifests changed.
3. Confirm error paths make no partial edits and duplicate names require a UUID.
4. For geometry changes, validate hierarchy plus world-space relationships from front, side, top, and three-quarter views. Projection overlap alone is not proof of contact.
5. Perform a live MCP call only if the user confirms Blockbench has loaded the matching build. Use dedicated tools, MCP Inspector, read-only project inspection, and screenshots; never replace a running artifact implicitly.
6. If correct structure or depth remains uncertain, stop at a reversible checkpoint and ask the user to inspect the model.

Report the exact commands, tool parameters, observed results, and any untested live-only behavior.
