import { clientManagerTeardown, showClientManager } from "@/ui/clientManager";

export type McpServerRuntimeState = "stopped" | "starting" | "running" | "stopping";

export type McpServerStatus = {
  state: McpServerRuntimeState;
  url: string;
  authenticationEnabled: boolean;
  connectedClients: number;
  connectedSessions: number;
};

export type McpServerControlHandlers = {
  start: () => void | Promise<void>;
  stop: () => void | Promise<void>;
  getStatus: () => McpServerStatus;
};

const actions: Action[] = [];
let statusDialog: Dialog | undefined;

function addToolsAction(id: string, options: ConstructorParameters<typeof Action>[1]): void {
  const action = new Action(id, options);
  actions.push(action);
  MenuBar.menus.tools.addAction(action);
}

function reportControlError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[Codex MCP] Server control failed:", error);
  Blockbench.showMessageBox({
    title: tl("mcp.server_controls.error_title"),
    message,
    icon: "error",
    buttons: ["dialog.ok"],
  });
}

function runControl(operation: () => void | Promise<void>): void {
  try {
    void Promise.resolve(operation()).catch(reportControlError);
  } catch (error) {
    reportControlError(error);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function statusRow(
  label: string,
  value: string,
  options: { code?: boolean; warning?: boolean } = {}
): string {
  const { code = false, warning = false } = options;
  const content = code
    ? `<code style="font-family: var(--font-code); word-break: break-all; user-select: text;">${escapeHtml(value)}</code>`
    : `<span>${escapeHtml(value)}</span>`;
  const color = warning ? "var(--color-warning, #f0a020)" : "var(--color-text)";
  return [
    `<div style="font-weight: 600; color: var(--color-subtle_text);">${escapeHtml(label)}</div>`,
    `<div style="min-width: 0; color: ${color};">${content}</div>`,
  ].join("");
}

function showStatus(status: McpServerStatus): void {
  const state = tl(`mcp.server_controls.state_${status.state}`);
  const authentication = tl(
    status.authenticationEnabled
      ? "mcp.server_controls.authentication_enabled"
      : "mcp.server_controls.authentication_disabled"
  );
  statusDialog?.delete();
  statusDialog = new Dialog({
    id: "codex_blockbench_mcp_server_status",
    title: tl("mcp.server_controls.status_title"),
    icon: status.state === "running" ? "check_circle" : "info",
    width: 540,
    lines: [
      `<div style="display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 10px 18px; align-items: start; padding: 6px 2px;">${[
        statusRow(tl("mcp.server_controls.status_state"), state),
        statusRow(tl("mcp.server_controls.status_address"), status.url, { code: true }),
        statusRow(tl("mcp.server_controls.status_authentication"), authentication, {
          warning: !status.authenticationEnabled,
        }),
        statusRow(tl("mcp.server_controls.status_clients"), String(status.connectedClients)),
        statusRow(tl("mcp.server_controls.status_sessions"), String(status.connectedSessions)),
      ].join("")}</div>`,
    ],
    singleButton: true,
    buttons: [tl("mcp.audit.ok")],
  });
  statusDialog.show();
}

export function serverControlsSetup(handlers: McpServerControlHandlers): void {
  if (actions.length > 0) return;

  addToolsAction("codex_blockbench_mcp_start_server", {
    name: tl("mcp.server_controls.start"),
    description: tl("mcp.server_controls.start_desc"),
    icon: "play_arrow",
    click: () => runControl(handlers.start),
  });
  addToolsAction("codex_blockbench_mcp_stop_server", {
    name: tl("mcp.server_controls.stop"),
    description: tl("mcp.server_controls.stop_desc"),
    icon: "stop",
    click: () => runControl(handlers.stop),
  });
  addToolsAction("codex_blockbench_mcp_show_server_status", {
    name: tl("mcp.server_controls.show_status"),
    description: tl("mcp.server_controls.show_status_desc"),
    icon: "info",
    click: () => showStatus(handlers.getStatus()),
  });
  addToolsAction("codex_blockbench_mcp_manage_clients", {
    name: tl("mcp.server_controls.manage_clients"),
    description: tl("mcp.server_controls.manage_clients_desc"),
    icon: "devices",
    click: () => showClientManager(),
  });
}

export function serverControlsTeardown(): void {
  actions.splice(0).forEach((action) => action.delete());
  statusDialog?.delete();
  statusDialog = undefined;
  clientManagerTeardown();
}
