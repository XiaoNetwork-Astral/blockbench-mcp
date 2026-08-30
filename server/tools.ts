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
import { registerExactTextureTools } from "./tools/exact-texture";
import { registerYsmTools } from "./tools/ysm";
import { registerSpatialTools } from "./tools/spatial";
import { registerValidationTools } from "./tools/validation";

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
  registerExactTextureTools,
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
  registerValidationTools,
  registerTextureTools,
  registerUVTools,
  registerValidatorResources,
];

// Register all core tools immediately when this module loads
for (const register of registrationFunctions) {
  register();
}

// YSM tools stay discoverable so ysm_set_workspace can configure first use.
registerYsmTools();

for (const register of [
  registerHytaleTools,
  registerHytaleResources,
  registerHytalePrompts,
]) {
  register();
}

export { tools };
