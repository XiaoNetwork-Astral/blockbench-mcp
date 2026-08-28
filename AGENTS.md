# General Blockbench Modeling Rules

This file can be used independently for ordinary Blockbench modeling and does not depend on project-specific instructions. The user's newer, explicit requirements for the current task take priority. Do not modify a project when the user has asked only to view or analyze it.

## Before Starting

1. Confirm whether the task is to create, adjust, or inspect something, and confirm the format, purpose, scale, coordinate orientation, texture dimensions, visual requirements, and deliverables.
2. First review the structure and versions of the reference material, then read every part on which the current judgment depends. Keep source facts, user opinions, inferences, and unknowns separate.
3. When adjusting an existing model, first read the project structure and state relevant to the requested change. Preserve unknown content by default.
4. When using a multi-project MCP, bind the target as the MCP working project. Do not switch its foreground tab unless the user asks to view that project.
5. Create a working copy or checkpoint before modifying the current baseline. Decisions that change structure, style, version, or overwrite files require user confirmation.
6. Unless the user explicitly requests importing a ready-made asset, do not generate a complete model or `.bbmodel` outside Blockbench and then import it wholesale.

## Building the Structure

- Plan the main body, parts, connectors, attachments, and structures that need independent movement before creating the Outliner group tree.
- Every newly created, copied, or moved node must have an explicit parent. Use the literal `root` only when the node truly belongs at the root level; report a missing, invalid, or ambiguous parent before making changes.
- Create parent groups first and read back their UUIDs, then create children in order. Prefer UUIDs when referring to objects.
- Work from “overall silhouette → primary volumes → connecting structures → secondary parts → details.” Validate one example before copying or expanding a repeated structure in bulk.
- At the end of each small stage, read back only the data involved in that stage. If a bulk operation partially fails, establish the actual state before continuing; do not layer more changes onto a partial result.

## Inspecting Geometry and Textures

- First establish what an attachment should connect to, the direction from which it should make contact, and whether intersection is permitted. Check parent-child relationships, world coordinates, and extents along all three axes.
- Inspect important structures from the front, side, top, and three-quarter views. Overlap in a single projection does not prove contact along the depth axis.
- For rotated objects, inspect the transformed vertices or mesh when necessary instead of relying only on an axis-aligned bounding box.
- Before texture operations, confirm the project resolution, source-image dimensions, and UV mode. After an important change, inspect pixel content, the texture UUID, UV ranges, and the viewport result.
- Create a separate group or bone only for a structure that needs independent motion. Place the pivot at the actual joint, hinge, or grip point, and test inheritance with a small rotation.
- Before export, confirm the save target and inspect the hierarchy, geometry, textures, or UVs that could have been affected within the scope of the current changes.

## Uncertainty and Delivery

- If the references are insufficient, structural meaning is unclear, multiple views still do not resolve the question, or repeated changes are not converging, stop modifying the model and preserve its current state.
- Give the user the relevant objects, coordinates, expected relationship, and most informative view. After the user corrects the interpretation, validate one small example first.
- A successful tool response does not prove the model is correct. Verify only the objects, data, and views that affect the current conclusion; do not mechanically repeat full inspections.
- Saving, overwriting a baseline, closing an unsaved tab, deleting experimental content, packaging, or publishing requires explicit authorization for that step.
- When the current stage is complete, state what was completed, what uncertainty remains, and what the user should inspect, then stop.
