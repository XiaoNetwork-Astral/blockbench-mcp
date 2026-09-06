/// <reference types="three" />
/// <reference types="blockbench-types" />

import { createTool, tools } from "@/lib/factories";
import { isHytalePluginInstalled } from "@/lib/hytale";
import {
  CORE_TOOL_SPECS,
  YSM_TOOL_SPECS,
  HYTALE_TOOL_SPECS,
} from "@/src/runtime/toolCatalog";
import { registerHytaleResources } from "./resources/hytale";
import { registerHytalePrompts } from "./prompts/hytale";
import { registerValidatorResources } from "./resources/validator";

// Runtime registration and documentation consume the same typed catalog.
// YSM remains discoverable before a workspace has been configured.
for (const definition of [...CORE_TOOL_SPECS, ...YSM_TOOL_SPECS]) {
  createTool(definition);
}

if (isHytalePluginInstalled()) {
  for (const definition of HYTALE_TOOL_SPECS) createTool(definition);
}

registerValidatorResources();
registerHytaleResources();
registerHytalePrompts();

export { tools };
