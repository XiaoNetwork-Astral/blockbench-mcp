import { z } from "zod";
import { defineTool, type ToolDefinition } from "@/lib/factories";
import { findElementOrThrow } from "@/lib/util";
import { finishCreatedOutlinerEdit, resolveOutlinerParentOrThrow, rollbackCreatedOutlinerEdit } from "@/lib/modelSafety";
import { elementConstructor, elementPropertiesSchema, describeElementTypes, assertElementTypeSupported, prepareElementProperties, applyElementProperties } from "@/src/blockbench/elementProperties";

export const nativeElementTools: ToolDefinition[] = [
  defineTool({
    name: "inspect_element_types",
    description: "Lists registered Blockbench element types, their format requirements, and editable native properties. Property names and enum values come from the installed Blockbench and plugins.",
    annotations: { title: "Inspect Element Types", readOnlyHint: true },
    parameters: z.object({}), status: "stable",
    async execute() { return JSON.stringify({ format: Format.id, types: describeElementTypes() }, null, 2); },
  }),
  defineTool({
    name: "create_element",
    description: "Creates a registered element from its native properties, including locators, null objects, texture meshes, billboards, bounding boxes and splines. Use inspect_element_types for properties; use the dedicated cube, mesh and armature tools for their geometry and hierarchy. New elements default to the Outliner root.",
    annotations: { title: "Create Element", destructiveHint: true },
    parameters: z.object({
      type: z.string().min(1), name: z.string().min(1), parent: z.string().min(1).default("root"),
      properties: elementPropertiesSchema.default({}),
    }).strict(), status: "stable",
    async execute({ type, name, parent, properties }) {
      const constructor = elementConstructor(type);
      assertElementTypeSupported(type);
      if (["cube", "mesh", "armature", "armature_bone"].includes(type)) {
        throw new Error(`Use the dedicated ${type} creation tool to specify its geometry or hierarchy.`);
      }
      const target = resolveOutlinerParentOrThrow(parent, type);
      const values = prepareElementProperties(constructor.properties, { ...properties, name });
      const element = new constructor(values);
      // Validate native conditions against the initialized property values before scene insertion.
      prepareElementProperties(constructor.properties, { ...properties, name }, element);
      Undo.initEdit({ elements: [], groups: [], outliner: true, collections: [] });
      try {
        element.addTo(target);
        element.init();
        element.addTo(target);
        finishCreatedOutlinerEdit(`Create ${type}`, [element]);
      } catch (error) {
        rollbackCreatedOutlinerEdit([element]);
        throw error;
      }
      Canvas.updateAll();
      return JSON.stringify({ uuid: element.uuid, name: element.name, type: element.type, parent: target === "root" ? "root" : target.uuid });
    },
  }),
  defineTool({
    name: "edit_element_properties",
    description: "Changes declared native properties on one element or group, with type and enum validation. Supports transforms and settings on locators, null objects, billboards, splines, meshes and other registered types. Use dedicated geometry, UV, reparenting and spline-point tools for structural changes.",
    annotations: { title: "Edit Element Properties", destructiveHint: true },
    parameters: z.object({ id: z.string().min(1), properties: elementPropertiesSchema.refine(value => Object.keys(value).length > 0, "Provide at least one property.") }).strict(),
    status: "stable",
    async execute({ id, properties }) {
      const node = findElementOrThrow(id);
      const constructor = node.constructor as unknown as { properties: Parameters<typeof prepareElementProperties>[0] };
      const values = prepareElementProperties(constructor.properties, properties, node);
      Undo.initEdit(node instanceof Group ? { groups: [node], outliner: true } : { elements: [node], outliner: true });
      applyElementProperties(node, values);
      Undo.finishEdit("Edit element properties");
      return JSON.stringify({ uuid: node.uuid, name: node.name, type: node.type, updated: Object.keys(properties) });
    },
  }),
];
