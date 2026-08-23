# Hytale Model Creation Guide

This guide covers creating 3D models for Hytale using Blockbench with the Hytale plugin.

Grouped public tools use the envelope `{ "command": { "action": "...", "input": { ... } } }`.
The action names below are exact `command.action` values.

## Format Selection

Hytale uses two model formats:

### Character Format (`hytale_character`)
- **Block Size**: 64 pixels
- **Use Case**: Humanoid/creature models with complex rigs
- **Features**: Full bone hierarchy, attachments, animations

### Prop Format (`hytale_prop`)
- **Block Size**: 32 pixels
- **Use Case**: Items, weapons, decorative objects
- **Features**: Simpler structure, optimized for props

## Key Concepts

### Node Limit
Hytale has a **maximum of 255 nodes** per model. Nodes include:
- Groups/bones
- Individual cubes (excluding the main shape cube of a group)

Use `inspect_hytale` with action `hytale_validate_model` to check node count.

### Shading Modes
Cubes support four shading modes:
- `standard` - Normal lighting (default)
- `flat` - No lighting/shadows
- `fullbright` - Always fully lit (emissive effect)
- `reflective` - Reflective material

Set with `edit_hytale` action `hytale_set_cube_properties`.

### Double-Sided Faces
Enable `double_sided` on cubes to render both front and back faces. Useful for:
- Thin planes/quads
- Cloth/fabric elements
- Transparency effects

### Stretch vs Size
Hytale prefers **stretch** over floating-point sizes:
- Stretch is a multiplier [x, y, z] applied to the base cube
- Better UV handling than fractional sizes
- Use `edit_hytale` action `hytale_set_cube_stretch` and `inspect_hytale` action `hytale_get_cube_stretch`

### Quads
Hytale supports single-face quads (2D planes):
- Created with `edit_hytale` action `hytale_create_quad`
- Specify normal direction: +X, -X, +Y, -Y, +Z, -Z
- Automatically double-sided by default

## Workflow

1. **Create Project**: With the Hytale plugin installed, use `edit_projects` action `create_project` with format `hytale_character` or `hytale_prop` as appropriate.
2. **Build Skeleton**: Create the bone hierarchy with `edit_elements` action `add_group`. Every group must name an explicit parent; use `parent: "root"` only for an intentional root group.
3. **Add Geometry**: Use `create_cube` for cubes and `edit_hytale` action `hytale_create_quad` for flat surfaces. Every created element must specify its parent group UUID/name, or the explicit literal `"root"` when root placement is intended.
4. **Set Properties**: Apply shading modes and double-sided as needed
5. **Validate**: Run `inspect_hytale` action `hytale_validate_model` before export

## Texture Guidelines

- Character textures: 64x64 or multiples for flipbooks
- Prop textures: 32x32 or multiples for flipbooks
- UV size must match texture resolution
- Use integer positions for pixel-perfect UVs

## Tips

- Keep node count under 255
- Use stretch for scaling instead of fractional sizes
- Group related cubes under bones for animation
- Inspect front, side, top, and three-quarter views for every important attachment; matching in one projection does not prove that parts touch in depth
- Mark attachment bones with `is_piece: true` using `edit_hytale` action `hytale_set_attachment_piece`
