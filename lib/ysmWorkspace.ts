const STORAGE_KEY = "codex_blockbench_mcp.ysm_workspace";

type ScopedFs = typeof import("node:fs");
type CryptoModule = typeof import("node:crypto");

let workspaceRoot = "";
let scopedFs: ScopedFs | null = null;
let cryptoModule: CryptoModule | null = null;
const actions: Action[] = [];

function normalizedRoot(value: string): string {
  return PathModule.resolve(value);
}

export function getYsmWorkspaceRoot(): string {
  if (!workspaceRoot) {
    workspaceRoot = localStorage.getItem(STORAGE_KEY) || "";
  }
  return workspaceRoot;
}

export function setYsmWorkspaceRoot(value: string, requestPermission = true): boolean {
  workspaceRoot = normalizedRoot(value);
  localStorage.setItem(STORAGE_KEY, workspaceRoot);
  scopedFs = null;
  return requestPermission ? ensureYsmWorkspaceAccess(true) : true;
}

export function chooseYsmWorkspace(): boolean {
  const selected = Blockbench.pickDirectory({
    title: "Choose the Codex/YSM writable workspace",
    startpath: getYsmWorkspaceRoot() || undefined,
    resource_id: "codex_blockbench_mcp_ysm_workspace",
  });
  if (!selected) return false;
  const ok = setYsmWorkspaceRoot(selected, true);
  if (ok) {
    Blockbench.showQuickMessage(`Codex/YSM workspace: ${workspaceRoot}`, 4500);
  }
  return ok;
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
        : "No YSM workspace is configured. Use ysm_set_workspace or the Tools menu first."
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

function addAction(id: string, options: ConstructorParameters<typeof Action>[1]): void {
  const action = new Action(id, options);
  actions.push(action);
  MenuBar.menus.tools.addAction(action);
}

export function setupYsmWorkspaceUi(): void {
  getYsmWorkspaceRoot();
  addAction("codex_blockbench_mcp_choose_ysm_workspace", {
    name: "Codex Blockbench MCP: Choose YSM Workspace",
    description: "Choose the only folder where Codex may synchronize YSM model files",
    icon: "folder_open",
    click: chooseYsmWorkspace,
  });
  addAction("codex_blockbench_mcp_show_ysm_workspace", {
    name: "Codex Blockbench MCP: Show YSM Workspace",
    description: "Show the current folder-scoped YSM workspace",
    icon: "info",
    click: () => {
      Blockbench.showMessageBox({
        title: "Codex Blockbench MCP",
        message: getYsmWorkspaceRoot() || "No YSM workspace is configured.",
        buttons: ["OK"],
      });
    },
  });
}

export function teardownYsmWorkspaceUi(): void {
  actions.splice(0).forEach((action) => action.delete());
  scopedFs = null;
  cryptoModule = null;
}
