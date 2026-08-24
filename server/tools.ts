/// <reference types="three" />
/// <reference types="blockbench-types" />

import { tools } from "@/lib/factories";

// Import tool registration functions
import { registerCameraTools } from "./tools/camera";
import { registerAnimationTools } from "./tools/animation";
import { registerCubesTools } from "./tools/cubes";
import { registerDisplayTools } from "./tools/display";
import { registerElementTools } from "./tools/element";
import { registerImportTools } from "./tools/import";
import { registerMeshTools } from "./tools/mesh";
import { registerPaintTools } from "./tools/paint";
import { registerProjectTools } from "./tools/project";
import { registerTextureTools } from "./tools/texture";
import { registerUVTools } from "./tools/uv";
import { registerMaterialInstanceTools } from "./tools/material-instances";
import { registerArmatureTools } from "./tools/armature";
import { registerHistoryTools } from "./tools/history";
import { registerExportTools } from "./tools/export";
import { registerCodexTextureTools } from "./tools/codex-texture";
import { registerYsmTools } from "./tools/ysm";
import { registerWorkflowTools } from "./tools/workflow";
import { registerSpatialTools } from "./tools/spatial";
import { getInitialPluginWorkspaceRoot } from "@/lib/pluginWorkspace";

// Optional plugin integrations. Each function performs its own runtime check.
import { registerHytaleTools } from "./tools/hytale";
import { registerHytaleResources } from "./resources/hytale";
import { registerHytalePrompts } from "./prompts/hytale";

// Core resource registrations
import { registerValidatorResources } from "./resources/validator";

// All registration functions - MUST be used to prevent tree-shaking
const registrationFunctions = [
  registerAnimationTools,
  registerArmatureTools,
  registerCameraTools,
  registerCodexTextureTools,
  registerCubesTools,
  registerDisplayTools,
  registerElementTools,
  registerExportTools,
  registerHistoryTools,
  registerImportTools,
  registerMaterialInstanceTools,
  registerMeshTools,
  registerPaintTools,
  registerProjectTools,
  registerSpatialTools,
  registerTextureTools,
  registerUVTools,
  registerValidatorResources,
];

// Register all core tools immediately when this module loads
for (const register of registrationFunctions) {
  register();
}

// YSM tools are optional and appear when the plugin workspace is configured.
if (getInitialPluginWorkspaceRoot()) {
  registerYsmTools();
  registerWorkflowTools();
}

for (const register of [
  registerHytaleTools,
  registerHytaleResources,
  registerHytalePrompts,
]) {
  register();
}

// Function to get tool count - called at runtime after registration
export function getToolCount(): number {
  return Object.keys(tools).length;
}

export { tools };
