# Import an explicitly requested geometry asset

- Use an import workflow only when the user supplied an asset or explicitly asked for one to be generated outside Blockbench.
- Validate the target format, scale, axes, texture resolution, bone hierarchy, and current unsaved state before importing.
- Treat import as one reversible stage. Inspect the resulting Outliner, object counts, UUIDs, parents, UVs, and several camera views before making further edits.
- Do not use an external `.geo.json` or `.bbmodel` builder merely to bypass the visible-project, Undo, or user-review boundaries.
