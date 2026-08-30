import type { ToolSpec } from "@/lib/factories";
import {
  animationInspectionToolDocs,
  animationManagementToolDoc,
  animationToolDocs,
} from "@/server/tools/animation";
import { armatureToolDocs } from "@/server/tools/armature";
import { cameraToolDocs } from "@/server/tools/camera";
import { cubeToolDocs } from "@/server/tools/cubes";
import { displayToolDocs } from "@/server/tools/display";
import { elementToolDocs } from "@/server/tools/element";
import { exactTextureToolDocs } from "@/server/tools/exact-texture";
import { exportToolDocs } from "@/server/tools/export";
import { historyToolDocs } from "@/server/tools/history";
import { hytaleToolDocs } from "@/server/tools/hytale";
import { importToolDocs } from "@/server/tools/import";
import { materialInstanceToolDocs } from "@/server/tools/material-instances";
import { meshToolDocs } from "@/server/tools/mesh";
import { paintToolDocs } from "@/server/tools/paint";
import { projectToolDocs } from "@/server/tools/project";
import { spatialToolDocs } from "@/server/tools/spatial";
import { textureToolDocs } from "@/server/tools/texture";
import { uvToolDocs } from "@/server/tools/uv";
import { validationOperationDocs } from "@/server/tools/validation";
import { workflowToolDocs } from "@/server/tools/workflow";
import {
  ysmMolangEditToolDocs,
  ysmMolangReadToolDocs,
} from "@/server/tools/ysm-molang";
import { ysmToolDocs } from "@/server/tools/ysm";

export interface ToolCategory {
  category: string;
  tools: readonly ToolSpec[];
  optional?: boolean;
}

export const CORE_TOOL_CATEGORIES: readonly ToolCategory[] = [
  { category: "Projects", tools: projectToolDocs },
  { category: "Elements", tools: elementToolDocs },
  { category: "Cubes", tools: cubeToolDocs },
  { category: "Meshes", tools: meshToolDocs },
  { category: "Armatures", tools: armatureToolDocs },
  {
    category: "Animation",
    tools: [
      ...animationInspectionToolDocs,
      animationManagementToolDoc,
      ...animationToolDocs,
    ],
  },
  { category: "Display", tools: displayToolDocs },
  { category: "Camera and capture", tools: cameraToolDocs },
  { category: "Textures", tools: textureToolDocs },
  { category: "Exact texture editing", tools: exactTextureToolDocs },
  { category: "Paint", tools: paintToolDocs },
  { category: "Material instances", tools: materialInstanceToolDocs },
  { category: "UV", tools: uvToolDocs },
  { category: "Spatial analysis", tools: spatialToolDocs },
  { category: "Validation", tools: validationOperationDocs },
  { category: "History", tools: historyToolDocs },
  { category: "Import", tools: importToolDocs },
  { category: "Export", tools: exportToolDocs },
];

export const YSM_TOOL_CATEGORIES: readonly ToolCategory[] = [
  { category: "YSM workspace", tools: ysmToolDocs },
  { category: "YSM workflow", tools: workflowToolDocs },
  {
    category: "YSM Molang",
    tools: [...ysmMolangReadToolDocs, ...ysmMolangEditToolDocs],
  },
];

export const HYTALE_TOOL_CATEGORIES: readonly ToolCategory[] = [
  { category: "Hytale", tools: hytaleToolDocs, optional: true },
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
