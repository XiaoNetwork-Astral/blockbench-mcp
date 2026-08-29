import { PLUGIN_WORKSPACE_SETTING, getStoredSettingValue } from "@/lib/pluginSettings";
import {
  LEGACY_PLUGIN_WORKSPACE_SETTING,
  LEGACY_PLUGIN_WORKSPACE_STORAGE_KEY,
} from "@/lib/brandingMigration";

type ScopedFs = typeof import("node:fs");
type CryptoModule = typeof import("node:crypto");

let workspaceRoot = "";
let scopedFs: ScopedFs | null = null;
let cryptoModule: CryptoModule | null = null;

function normalizedRoot(value: unknown): string {
  const candidate = String(value ?? "").trim();
  return candidate ? PathModule.resolve(candidate) : "";
}

export function getInitialPluginWorkspaceRoot(): string {
  const stored = String(
    getStoredSettingValue(PLUGIN_WORKSPACE_SETTING)
      ?? getStoredSettingValue(LEGACY_PLUGIN_WORKSPACE_SETTING)
      ?? ""
  ).trim();
  if (stored) {
    workspaceRoot = normalizedRoot(stored);
    return workspaceRoot;
  }

  // Migrate the path selected by older builds from localStorage into the new
  // native Setting. Once migrated, clearing the Setting must not resurrect it.
  const legacy = typeof localStorage === "undefined"
    ? ""
    : String(localStorage.getItem(LEGACY_PLUGIN_WORKSPACE_STORAGE_KEY) ?? "").trim();
  if (legacy && typeof localStorage !== "undefined") {
    localStorage.removeItem(LEGACY_PLUGIN_WORKSPACE_STORAGE_KEY);
  }
  workspaceRoot = normalizedRoot(legacy);
  return workspaceRoot;
}

export function getPluginWorkspaceRoot(): string {
  if (typeof Settings !== "undefined") {
    const configured = Settings.get(PLUGIN_WORKSPACE_SETTING);
    if (configured !== undefined) workspaceRoot = normalizedRoot(configured);
  }
  return workspaceRoot;
}

export function syncPluginWorkspaceRootFromSetting(value: unknown): void {
  workspaceRoot = normalizedRoot(value);
  scopedFs = null;
}

export function setPluginWorkspaceRoot(value: string, requestPermission = true): boolean {
  const normalized = normalizedRoot(value);
  if (typeof settings !== "undefined") {
    settings[PLUGIN_WORKSPACE_SETTING]?.set(normalized);
  }
  // Keep the runtime scope synchronized even if Setting.set() does not invoke
  // onChange in the current Blockbench version.
  syncPluginWorkspaceRootFromSetting(normalized);
  if (!workspaceRoot) return !requestPermission;
  return requestPermission ? ensurePluginWorkspaceAccess(true) : true;
}

export function choosePluginWorkspace(): boolean {
  const selected = Blockbench.pickDirectory({
    title: tl("mcp.settings.plugin_workspace_picker_title"),
    startpath: getPluginWorkspaceRoot() || undefined,
    resource_id: "blockbench_mcp_ysm_workspace",
  });
  if (!selected) return false;
  return setPluginWorkspaceRoot(selected, true);
}

export function ensurePluginWorkspaceAccess(showPermissionDialog: boolean): boolean {
  if (!getPluginWorkspaceRoot()) return false;
  if (scopedFs) return true;
  // @ts-ignore - Blockbench's generated overload omits scoped fs although it is supported at runtime.
  scopedFs = requireNativeModule("fs", {
    scope: workspaceRoot,
    optional: true,
    show_permission_dialog: showPermissionDialog,
    message: "The Blockbench MCP plugin only needs access inside the selected plugin workspace.",
  }) as ScopedFs | undefined ?? null;
  return Boolean(scopedFs);
}

function requireWorkspace(): ScopedFs {
  if (!ensurePluginWorkspaceAccess(true) || !scopedFs) {
    throw new Error(
      getPluginWorkspaceRoot()
        ? "Folder-scoped access to the configured plugin workspace was denied."
        : "No plugin workspace is configured. Set it in Blockbench MCP settings."
    );
  }
  return scopedFs;
}

function isInsideWorkspace(absolutePath: string): boolean {
  const relative = PathModule.relative(getPluginWorkspaceRoot(), absolutePath);
  return (
    relative === "" ||
    (!relative.startsWith(`..${PathModule.sep}`) &&
      relative !== ".." &&
      !PathModule.isAbsolute(relative))
  );
}

export function resolvePluginWorkspacePath(relativePath: string): string {
  if (!relativePath || PathModule.isAbsolute(relativePath)) {
    throw new Error(`Paths must be relative to the plugin workspace: ${relativePath}`);
  }
  const absolutePath = PathModule.resolve(getPluginWorkspaceRoot(), relativePath);
  if (!isInsideWorkspace(absolutePath)) {
    throw new Error(`Path escapes the plugin workspace: ${relativePath}`);
  }
  return absolutePath;
}

export function relativePluginWorkspacePath(absolutePath: string): string | null {
  const resolved = PathModule.resolve(absolutePath);
  if (!isInsideWorkspace(resolved)) return null;
  return PathModule.relative(getPluginWorkspaceRoot(), resolved).split(PathModule.sep).join("/");
}

export function readWorkspaceJson(relativePath: string): Record<string, unknown> {
  const fs = requireWorkspace();
  const absolutePath = resolvePluginWorkspacePath(relativePath);
  const text = fs.readFileSync(absolutePath, "utf8");
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${relativePath}: ${error instanceof Error ? error.message : error}`
    );
  }
}

export function readWorkspaceText(relativePath: string): string {
  const fs = requireWorkspace();
  return fs.readFileSync(resolvePluginWorkspacePath(relativePath), "utf8");
}

export function readWorkspaceBytes(relativePath: string): Uint8Array {
  const fs = requireWorkspace();
  return fs.readFileSync(resolvePluginWorkspacePath(relativePath));
}

export function workspaceFileExists(relativePath: string): boolean {
  const fs = requireWorkspace();
  const absolutePath = resolvePluginWorkspacePath(relativePath);
  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
}

export function workspaceDirectoryExists(relativePath: string): boolean {
  const fs = requireWorkspace();
  const absolutePath = resolvePluginWorkspacePath(relativePath);
  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory();
}

export function listWorkspaceFiles(
  relativeDirectory: string,
  options: { extension?: string; limit?: number } = {}
): { files: string[]; truncated: boolean } {
  const fs = requireWorkspace();
  const start = resolvePluginWorkspacePath(relativeDirectory);
  if (!fs.existsSync(start) || !fs.statSync(start).isDirectory()) {
    return { files: [], truncated: false };
  }
  const limit = Math.max(1, Math.min(options.limit ?? 512, 4096));
  const extension = options.extension?.toLocaleLowerCase();
  const files: string[] = [];
  let truncated = false;
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (files.length >= limit) {
        truncated = true;
        return;
      }
      const absolute = PathModule.join(directory, entry.name);
      if (!isInsideWorkspace(absolute)) continue;
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && (!extension || entry.name.toLocaleLowerCase().endsWith(extension))) {
        const relative = relativePluginWorkspacePath(absolute);
        if (relative) files.push(relative);
      }
    }
  };
  visit(start);
  files.sort((a, b) => a.localeCompare(b));
  return { files, truncated };
}

function crypto(): CryptoModule {
  if (!cryptoModule) {
    cryptoModule = requireNativeModule("crypto") as CryptoModule | undefined ?? null;
  }
  if (!cryptoModule) throw new Error("Blockbench did not grant access to the crypto module.");
  return cryptoModule;
}

export function sha256WorkspaceFile(relativePath: string): string {
  const fs = requireWorkspace();
  return crypto()
    .createHash("sha256")
    .update(fs.readFileSync(resolvePluginWorkspacePath(relativePath)))
    .digest("hex");
}

export function sha256WorkspaceValue(value: string | Uint8Array): string {
  return crypto().createHash("sha256").update(value).digest("hex");
}

function atomicWrite(relativePath: string, value: string | Uint8Array): void {
  const fs = requireWorkspace();
  const absolutePath = resolvePluginWorkspacePath(relativePath);
  fs.mkdirSync(PathModule.dirname(absolutePath), { recursive: true });
  const temporary = `${absolutePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    fs.writeFileSync(temporary, value);
    fs.renameSync(temporary, absolutePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function atomicWriteWorkspaceJson(
  relativePath: string,
  value: Record<string, unknown>
): void {
  atomicWrite(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function atomicWriteWorkspaceText(relativePath: string, value: string): void {
  atomicWrite(relativePath, value);
}

export function atomicWriteWorkspaceBytes(relativePath: string, value: Uint8Array): void {
  atomicWrite(relativePath, value);
}

export function teardownPluginWorkspace(): void {
  scopedFs = null;
  cryptoModule = null;
}
