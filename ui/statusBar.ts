import {
  isProjectReadOnly,
  setProjectReadOnly,
  subscribeProjectReadOnly,
} from "@/src/features/readOnly/service";
import {
  getMcpServerState,
  subscribeMcpServerState,
} from "@/lib/serverRuntime";
import statusBarCSS from "@/ui/statusBar.css";

interface StatusBarUi {
  root: HTMLDivElement;
  protectionButton: HTMLButtonElement;
  protectionIcon: HTMLElement;
  protectionText: HTMLSpanElement;
}

let statusBarUi: StatusBarUi | undefined;
let cssHandle: Deletable | undefined;
let unsubscribeServerState: (() => void) | undefined;
let unsubscribeProtection: (() => void) | undefined;
const projectListeners: Array<{
  event: EventName;
  callback: (data: any) => void;
}> = [];

function updateProtectionButton(): void {
  if (!statusBarUi) return;
  const { protectionButton, protectionIcon, protectionText } = statusBarUi;
  const project = Project;
  protectionButton.hidden = !project;
  if (!project) return;

  const readOnly = isProjectReadOnly(project);
  protectionButton.classList.toggle("read-only", readOnly);
  protectionButton.setAttribute("aria-pressed", String(readOnly));
  protectionIcon.textContent = readOnly ? "lock" : "lock_open";
  protectionText.textContent = tl(
    readOnly
      ? "mcp.project.state_read_only"
      : "mcp.project.state_writable"
  );
  protectionButton.title = tl(
    readOnly
      ? "mcp.project.make_writable"
      : "mcp.project.make_read_only"
  );
  protectionButton.setAttribute("aria-label", protectionButton.title);
}

function toggleProjectProtection(): void {
  const project = Project;
  if (!project) return;
  setProjectReadOnly(project, !isProjectReadOnly(project));
  const next = isProjectReadOnly(project);
  Blockbench.showQuickMessage(
    tl(
      next
        ? "mcp.project.state_read_only"
        : "mcp.project.state_writable"
    ),
    1800
  );
}

function listenProjectEvent(event: EventName): void {
  const callback = () => queueMicrotask(updateProtectionButton);
  Blockbench.on(event, callback);
  projectListeners.push({ event, callback });
}

export function statusBarSetup(): void {
  cssHandle = Blockbench.addCSS(statusBarCSS);

  const root = document.createElement("div");
  root.id = "mcp-status-bar";

  const protectionButton = document.createElement("button");
  protectionButton.type = "button";
  protectionButton.className = "mcp-project-protection";
  protectionButton.addEventListener("click", toggleProjectProtection);

  const protectionIcon = document.createElement("i");
  protectionIcon.className = "material-icons";
  const protectionText = document.createElement("span");
  protectionButton.appendChild(protectionIcon);
  protectionButton.appendChild(protectionText);

  const statusIndicator = document.createElement("div");
  statusIndicator.className = "mcp-status-indicator";

  const statusDot = document.createElement("div");
  statusDot.className = "mcp-status-dot";

  const statusText = document.createElement("span");
  statusText.className = "mcp-status-text";
  statusText.textContent = tl("mcp.status.server");

  const serverInfo = document.createElement("span");
  serverInfo.className = "mcp-server-info";

  statusIndicator.appendChild(statusDot);
  statusIndicator.appendChild(statusText);
  statusIndicator.appendChild(serverInfo);

  root.appendChild(protectionButton);
  root.appendChild(statusIndicator);
  statusBarUi = { root, protectionButton, protectionIcon, protectionText };

  const updateStatus = () => {
    const state = getMcpServerState();
    statusDot.className = `mcp-status-dot ${state}`;
    statusText.textContent = `${tl("mcp.status.server")}: ${tl(
      `mcp.server_controls.state_${state}`
    )}`;
    serverInfo.textContent = "";
  };

  unsubscribeServerState = subscribeMcpServerState(updateStatus);
  unsubscribeProtection = subscribeProjectReadOnly((project) => {
    if (project === Project) updateProtectionButton();
  });
  listenProjectEvent("select_project");
  listenProjectEvent("load_project");
  listenProjectEvent("close_project");
  updateProtectionButton();

  document.getElementById("status_bar")!.appendChild(root);
}

export function statusBarTeardown(): void {
  unsubscribeServerState?.();
  unsubscribeServerState = undefined;
  unsubscribeProtection?.();
  unsubscribeProtection = undefined;
  for (const { event, callback } of projectListeners.splice(0)) {
    Blockbench.removeListener(event, callback);
  }

  statusBarUi?.root.remove();
  statusBarUi = undefined;
  cssHandle?.delete();
  cssHandle = undefined;
}
