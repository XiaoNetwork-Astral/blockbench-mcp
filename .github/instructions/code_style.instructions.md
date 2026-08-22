---
applyTo: '**/*.ts'
---

The code is written in TypeScript and follows a consistent style. It uses modern JavaScript features and adheres to best practices for readability and maintainability.

- Use `const` for constants and `let` for variables that may change.
- Use `async/await` for asynchronous operations, and handle errors with `try/catch`.
- Avoid using `if/else` statements for flow control; prefer early returns to reduce nesting.
- Avoid `any`; when incomplete Blockbench typings make an escape unavoidable, keep it narrow and explain the boundary.
- Prefer TypeScript interfaces over types for defining object shapes.
- Never implement placeholder functions, always provide a complete implementation.

This project uses Bun to compile the code into JavaScript for Blockbench to execute in its Electron Node.js environment. The plugin utilizes FastMCP for handling the MCP protocol in TypeScript.

When adding Blockbench-related features, follow the behavioral boundaries in `AGENTS.md` and the repository patterns in `CONTRIBUTING.md`. Reference current Blockbench source only when local code and types are insufficient. Schema modules must not access Blockbench globals at import time.

#githubRepo JannisX11/blockbench-plugins
#githubRepo JannisX11/blockbench
#githubRepo punkpeye/fastmcp

Blockbench TypeScript support is incomplete, so some workarounds are necessary:
- Prefer local interfaces and runtime guards. Use `// @ts-expect-error` only at a verified missing-type boundary and state what upstream typing is absent; do not use broad `// @ts-ignore` as a default.
