import { YSM_WORKSPACE_SETTING, getStoredSettingValue } from "@/lib/pluginSettings";

const LEGACY_STORAGE_KEY = "codex_blockbench_mcp.ysm_workspace";

type ScopedFs = typeof import("node:fs");
type CryptoModule = typeof import("node:crypto");

let workspaceRoot = "";
let scopedFs: ScopedFs | null = null;
let cryptoModule: CryptoModule | null = null;

function normalizedRoot(value: unknown): string {
  const candidate = String(value ?? "").trim();
  return candidate ? PathModule.resolve(candidate) : "";
}

export function getInitialYsmWorkspaceRoot(): string {
  const stored = String(getStoredSettingValue(YSM_WORKSPACE_SETTING) ?? "").trim();
  if (stored) {
    workspaceRoot = normalizedRoot(stored);
    return workspaceRoot;
  }

  // Migrate the path selected by older builds from localStorage into the new
  // native Setting. Once migrated, clearing the Setting must not resurrect it.
  const legacy = typeof localStorage === "undefined"
    ? ""
    : String(localStorage.getItem(LEGACY_STORAGE_KEY) ?? "").trim();
  if (legacy && typeof localStorage !== "undefined") {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
  workspaceRoot = normalizedRoot(legacy);
  return workspaceRoot;
}

export function getYsmWorkspaceRoot(): string {
  if (typeof Settings !== "undefined") {
    const configured = Settings.get(YSM_WORKSPACE_SETTING);
    if (configured !== undefined) workspaceRoot = normalizedRoot(configured);
  }
  return workspaceRoot;
}

export function syncYsmWorkspaceRootFromSetting(value: unknown): void {
  workspaceRoot = normalizedRoot(value);
  scopedFs = null;
}

export function setYsmWorkspaceRoot(value: string, requestPermission = true): boolean {
  const normalized = normalizedRoot(value);
  if (typeof settings !== "undefined") {
    settings[YSM_WORKSPACE_SETTING]?.set(normalized);
  }
  // Keep the runtime scope synchronized even if Setting.set() does not invoke
  // onChange in the current Blockbench version.
  syncYsmWorkspaceRootFromSetting(normalized);
  if (!workspaceRoot) return !requestPermission;
  return requestPermission ? ensureYsmWorkspaceAccess(true) : true;
}

export function chooseYsmWorkspace(): boolean {
  const selected = Blockbench.pickDirectory({
    title: tl("mcp.settings.temporary_directory_picker_title"),
    startpath: getYsmWorkspaceRoot() || undefined,
    resource_id: "codex_blockbench_mcp_ysm_workspace",
  });
  if (!selected) return false;
  return setYsmWorkspaceRoot(selected, true);
}

export function ensureYsmWorkspaceAccess(showPermissionDialog: boolean): boolean {
  if (!getYsmWorkspaceRoot()) return false;
  if (scopedFs) return true;
  // @ts-ignore - Blockbench's generated overload omits scoped fs although it is supported at runtime.
  scopedFs = requireNativeModule("fs", {
    scope: workspaceRoot,
    optional: true,
    show_permission_dialog: showPermissionDialog,
    message:
      "Codex Blockbench MCP only needs read/write access inside the selected .codex temporary model workspace.",
  }) as ScopedFs | undefined ?? null;
  return Boolean(scopedFs);
}

function requireWorkspace(): ScopedFs {
  if (!ensureYsmWorkspaceAccess(true) || !scopedFs) {
    throw new Error(
      getYsmWorkspaceRoot()
        ? "Folder-scoped access to the configured YSM workspace was denied."
        : "No temporary model directory is configured. Set it in Codex Blockbench MCP settings or use ysm_set_workspace."
    );
  }
  return scopedFs;
}

function isInsideWorkspace(absolutePath: string): boolean {
  const relative = PathModule.relative(getYsmWorkspaceRoot(), absolutePath);
  return (
    relative === "" ||
    (!relative.startsWith(`..${PathModule.sep}`) &&
      relative !== ".." &&
      !PathModule.isAbsolute(relative))
  );
}

export function resolveYsmWorkspacePath(relativePath: string): string {
  if (!relativePath || PathModule.isAbsolute(relativePath)) {
    throw new Error(`YSM paths must be non-empty workspace-relative paths: ${relativePath}`);
  }
  const absolutePath = PathModule.resolve(getYsmWorkspaceRoot(), relativePath);
  if (!isInsideWorkspace(absolutePath)) {
    throw new Error(`YSM path escapes the selected workspace: ${relativePath}`);
  }
  return absolutePath;
}

export function relativeYsmWorkspacePath(absolutePath: string): string | null {
  const resolved = PathModule.resolve(absolutePath);
  if (!isInsideWorkspace(resolved)) return null;
  return PathModule.relative(getYsmWorkspaceRoot(), resolved).split(PathModule.sep).join("/");
}

export function readWorkspaceJson(relativePath: string): Record<string, unknown> {
  const fs = requireWorkspace();
  const absolutePath = resolveYsmWorkspacePath(relativePath);
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
  return fs.readFileSync(resolveYsmWorkspacePath(relativePath), "utf8");
}

export function workspaceFileExists(relativePath: string): boolean {
  const fs = requireWorkspace();
  const absolutePath = resolveYsmWorkspacePath(relativePath);
  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
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
    .update(fs.readFileSync(resolveYsmWorkspacePath(relativePath)))
    .digest("hex");
}

function atomicWrite(relativePath: string, value: string | Uint8Array): void {
  const fs = requireWorkspace();
  const absolutePath = resolveYsmWorkspacePath(relativePath);
  fs.mkdirSync(PathModule.dirname(absolutePath), { recursive: true });
  const temporary = `${absolutePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(temporary, value);
  fs.renameSync(temporary, absolutePath);
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

export function teardownYsmWorkspace(): void {
  scopedFs = null;
  cryptoModule = null;
}
