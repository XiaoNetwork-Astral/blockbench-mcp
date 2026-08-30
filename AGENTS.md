# Blockbench MCP Working Rules

The user's latest explicit request takes priority. Reading and analysis do not authorize edits.

## Before Starting

1. Inspect only the structure and source sections relevant to the request before changing them.
2. Every project-scoped tool acts on the Blockbench tab visible when that call begins. Use `select_project` when another tab should become visible; there is no background or connection-owned project.
3. Preserve content outside the requested scope. Use Blockbench Undo and focused tests for recoverability; ask before an overwrite, unsaved close, or other genuine loss boundary.
4. Do not import a wholesale generated model unless the user asked for an import.

## Building the Structure

- Plan the main body, parts, connectors, attachments, and structures that need independent movement before creating the Outliner group tree.
- New groups and geometry default to the Outliner root. Supply a parent when hierarchy matters; duplication stays beside the original by default, while an actual reparent operation always names its destination. Reject invalid or ambiguous names instead of guessing.
- Create parent groups before their children. Use readable exact names when they are unique; use a UUID only to disambiguate duplicate names.
- Work from “overall silhouette → primary volumes → connecting structures → secondary parts → details.” Validate one example before copying or expanding a repeated structure in bulk.
- At the end of each small stage, read back only the data involved in that stage. If a bulk operation partially fails, establish the actual state before continuing; do not layer more changes onto a partial result.

## Project instruction hygiene

- Keep the plugin workflow-neutral. Project-specific tab roles, file promotion procedures, and approval stages belong in that project's external memo; implement only the reusable operations needed to carry them out.
- Do not create or expand skills, prompt packs, policy files, reminder files, or mandatory instruction chains unless the user explicitly requests one.
- Keep behavior in source, tests, types, and ordinary documentation. State a rule once; do not duplicate it across skills, prompts, comments, and the project memo.
- Prefer a small invariant and a focused test over caller-supplied authorization tokens, hashes, UUID ceremonies, confirmation strings, or broad defensive wrappers.
- Retain checks for real ambiguity, explicit read-only state, untrusted input, bounded expensive work, workspace confinement, and irreversible actions.

## Inspecting Geometry and Textures

- First establish what an attachment should connect to, the direction from which it should make contact, and whether intersection is permitted. Check parent-child relationships, world coordinates, and extents along all three axes.
- Inspect important structures from the front, side, top, and three-quarter views. Overlap in a single projection does not prove contact along the depth axis.
- For rotated objects, inspect the transformed vertices or mesh when necessary instead of relying only on an axis-aligned bounding box.
- Before texture operations, confirm the project resolution, source-image dimensions, and UV mode. After an important change, inspect the affected pixels, UV ranges, and viewport result.
- Create a separate group or bone only for a structure that needs independent motion. Place the pivot at the actual joint, hinge, or grip point, and test inheritance with a small rotation.
- Before export, confirm the save target and inspect the hierarchy, geometry, textures, or UVs that could have been affected within the scope of the current changes.

## Uncertainty and Delivery

- If the references are insufficient, structural meaning is unclear, multiple views still do not resolve the question, or repeated changes are not converging, stop modifying the model and preserve its current state.
- Give the user the relevant objects, coordinates, expected relationship, and most informative view. After the user corrects the interpretation, validate one small example first.
- A successful tool response does not prove the model is correct. Verify only the objects, data, and views that affect the current conclusion; do not mechanically repeat full inspections.
- Overwriting an existing file, closing an unsaved tab, deleting material, committing, packaging, or publishing requires clear authorization for that target and scope.
- When the current stage is complete, state what was completed, what uncertainty remains, and what the user should inspect, then stop.
