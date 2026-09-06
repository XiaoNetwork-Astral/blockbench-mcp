import { z } from "zod";
import { findElementOrThrow } from "@/lib/util";

const scalar = z.union([z.string().max(16_384), z.number().finite(), z.boolean()]);
export const elementPropertiesSchema = z.record(z.string(), z.union([
  scalar, z.array(scalar).max(4096),
]));

export interface NativeProperty {
  type: string;
  exposed?: boolean;
  enum_values?: string[];
  condition?: ConditionResolvable;
  merge_validation?: (value: unknown) => boolean;
  merge(instance: OutlinerNode, data: Record<string, unknown>): void;
}

type ElementConstructor = {
  new(data: Record<string, unknown>): OutlinerElement;
  properties: Record<string, NativeProperty>;
};

const featureByType: Record<string, string> = {
  locator: "locators", null_object: "animation_mode", texture_mesh: "texture_meshes",
  billboard: "billboards", bounding_box: "bounding_boxes", spline: "splines",
  mesh: "meshes", armature: "armature_rig", armature_bone: "armature_rig",
};

export function elementConstructor(type: string): ElementConstructor {
  const constructor = (OutlinerElement.types as Record<string, ElementConstructor>)[type];
  if (!constructor) throw new Error(`Element type "${type}" is not registered. Use inspect_element_types.`);
  return constructor;
}

export function assertElementTypeSupported(type: string): void {
  const feature = featureByType[type];
  if (feature && !(Format as unknown as Record<string, unknown>)[feature]) {
    throw new Error(`Format "${Format.id}" does not support ${type} elements (${feature}).`);
  }
}

function editableProperty(property: NativeProperty): boolean {
  return property.exposed !== false && ["string", "molang", "enum", "number", "boolean", "vector", "vector2", "vector4", "array"].includes(property.type);
}

export function describeElementTypes() {
  return Object.entries(OutlinerElement.types).map(([type, constructor]) => ({
    type,
    required_feature: featureByType[type] ?? null,
    supported: !featureByType[type] || Boolean((Format as unknown as Record<string, unknown>)[featureByType[type]]),
    properties: Object.entries(constructor.properties).flatMap(([name, raw]) => {
      const property = raw as NativeProperty;
      if (!editableProperty(property) || name === "scope") return [];
      return [{ name, type: property.type, ...(property.enum_values ? { values: property.enum_values } : {}) }];
    }),
  }));
}

/** Validate the complete patch before opening Undo or applying any property. */
export function prepareElementProperties(
  properties: Record<string, NativeProperty>,
  input: z.infer<typeof elementPropertiesSchema>,
  node?: OutlinerNode
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(input)) {
    const property = Object.hasOwn(properties, name) ? properties[name] : undefined;
    if (!property || !editableProperty(property) || name === "scope") {
      throw new Error(`Property "${name}" is not editable through this operation. Use inspect_element_types.`);
    }
    let valid = false;
    switch (property.type) {
      case "string": valid = typeof value === "string"; break;
      case "molang": valid = typeof value === "string" || typeof value === "number"; break;
      case "enum": valid = typeof value === "string" && (!property.enum_values || property.enum_values.includes(value)); break;
      case "number": valid = typeof value === "number"; break;
      case "boolean": valid = typeof value === "boolean"; break;
      case "array": valid = Array.isArray(value); break;
      default: {
        const length = property.type === "vector" ? 3 : Number(property.type.slice(-1));
        valid = Array.isArray(value) && value.length === length && value.every(item => typeof item === "number");
      }
    }
    if (!valid || (property.merge_validation && !property.merge_validation(value))) {
      throw new Error(`Invalid ${property.type} value for element property "${name}".`);
    }
    if (node && property.condition && !Condition(property.condition, node)) {
      throw new Error(`Property "${name}" is unavailable for this element and format.`);
    }
    if ((name === "radial_resolution" || name === "tubular_resolution") &&
      (typeof value !== "number" || !Number.isInteger(value) || value < (name === "radial_resolution" ? 3 : 1) || value > 64)) {
      throw new Error(`${name} must be an integer between ${name === "radial_resolution" ? 3 : 1} and 64.`);
    }
    if (name === "radius_multiplier" && (typeof value !== "number" || value < 0)) {
      throw new Error("radius_multiplier must be non-negative.");
    }
    result[name] = (name === "ik_target" || name === "ik_source") && typeof value === "string" && value
      ? findElementOrThrow(value).uuid : value;
  }
  return result;
}

export function applyElementProperties(node: OutlinerNode, values: Record<string, unknown>): void {
  const constructor = node.constructor as unknown as { properties: Record<string, NativeProperty> };
  for (const name of Object.keys(values)) constructor.properties[name].merge(node, values);
  node.sanitizeName();
  const spline = node as OutlinerNode & { refreshTubeFaces?: () => void };
  spline.refreshTubeFaces?.();
  Canvas.updateAll();
}
