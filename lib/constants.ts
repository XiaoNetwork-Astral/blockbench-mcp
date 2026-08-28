import { version } from "../package.json" assert { type: "json" };

export const PLUGIN_ID = "blockbench_mcp";
export const PLUGIN_FILENAME = `${PLUGIN_ID}.js`;
export const SETTINGS_CATEGORY_ID = PLUGIN_ID;
export const VERSION = version;
export const STATUS_STABLE = "stable";
export const STATUS_EXPERIMENTAL = "experimental";
