import type { ToolDefinition } from "@/lib/factories";
import {
  animationInspectionTools,
  animationManagementTool,
  animationTools,
} from "@/server/tools/animation";
import { armatureTools } from "@/server/tools/armature";
import { animationControllerTools } from "@/server/tools/animation-controllers";
import { animationFileTools } from "@/server/tools/animation-files";
import { capabilityTools } from "@/server/tools/capabilities";
import { nativeElementTools } from "@/server/tools/native-elements";
import { elementGeometryTools } from "@/server/tools/element-geometry";
import { cameraTools } from "@/server/tools/camera";
import { cubeTools } from "@/server/tools/cubes";
import { displayTools } from "@/server/tools/display";
import { elementTools } from "@/server/tools/element";
import { exactTextureTools } from "@/server/tools/exact-texture";
import { exportTools } from "@/server/tools/export";
import { historyTools } from "@/server/tools/history";
import { hytaleTools } from "@/server/tools/hytale";
import { importTools } from "@/server/tools/import";
import { materialInstanceTools } from "@/server/tools/material-instances";
import { meshTools } from "@/server/tools/mesh";
import { paintTools } from "@/server/tools/paint";
import { projectTools } from "@/server/tools/project";
import { spatialTools } from "@/server/tools/spatial";
import { textureTools } from "@/server/tools/texture";
import { textureSettingsTools } from "@/server/tools/texture-settings";
import { modelFileTools } from "@/server/tools/model-files";
import { uvTools } from "@/server/tools/uv";
import { validationTools } from "@/server/tools/validation";
import {
  ysmMolangEditTools,
  ysmMolangReadTools,
} from "@/server/tools/ysm-molang";
import { ysmTools } from "@/server/tools/ysm";

export interface ToolCategory {
  category: string;
  tools: readonly ToolDefinition[];
  optional?: boolean;
}

export const CORE_TOOL_CATEGORIES: readonly ToolCategory[] = [
  { category: "Projects", tools: [...projectTools, ...capabilityTools] },
  { category: "Elements", tools: [...elementTools, ...nativeElementTools, ...elementGeometryTools] },
  { category: "Cubes", tools: cubeTools },
  { category: "Meshes", tools: meshTools },
  { category: "Armatures", tools: armatureTools },
  {
    category: "Animation",
    tools: [
      ...animationInspectionTools,
      animationManagementTool,
      ...animationTools,
      ...animationControllerTools,
      ...animationFileTools,
    ],
  },
  { category: "Display", tools: displayTools },
  { category: "Camera and capture", tools: cameraTools },
  { category: "Textures", tools: [...textureTools, ...textureSettingsTools] },
  { category: "Exact texture editing", tools: exactTextureTools },
  { category: "Paint", tools: paintTools },
  { category: "Material instances", tools: materialInstanceTools },
  { category: "UV", tools: uvTools },
  { category: "Spatial analysis", tools: spatialTools },
  { category: "Validation", tools: validationTools },
  { category: "History", tools: historyTools },
  { category: "Import", tools: [...importTools, ...modelFileTools] },
  { category: "Export", tools: exportTools },
];

export const YSM_TOOL_CATEGORIES: readonly ToolCategory[] = [
  { category: "YSM workspace", tools: ysmTools },
  {
    category: "YSM Molang",
    tools: [...ysmMolangReadTools, ...ysmMolangEditTools],
  },
];

export const HYTALE_TOOL_CATEGORIES: readonly ToolCategory[] = [
  { category: "Hytale", tools: hytaleTools, optional: true },
];

export const TOOL_CATEGORIES = [
  ...CORE_TOOL_CATEGORIES,
  ...YSM_TOOL_CATEGORIES,
  ...HYTALE_TOOL_CATEGORIES,
] as const;

export const CORE_TOOL_SPECS = CORE_TOOL_CATEGORIES.flatMap(({ tools }) => tools);
export const YSM_TOOL_SPECS = YSM_TOOL_CATEGORIES.flatMap(({ tools }) => tools);
export const HYTALE_TOOL_SPECS = HYTALE_TOOL_CATEGORIES.flatMap(({ tools }) => tools);
export const ALL_TOOL_SPECS = TOOL_CATEGORIES.flatMap(({ tools }) => tools);
