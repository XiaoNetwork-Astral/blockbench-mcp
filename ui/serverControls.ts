export type McpServerRuntimeState = "stopped" | "starting" | "running" | "stopping";

export type McpServerStatus = {
  state: McpServerRuntimeState;
  url: string;
  authenticationEnabled: boolean;
  connectedClients: number;
};

export type McpServerControlHandlers = {
  start: () => void | Promise<void>;
  stop: () => void | Promise<void>;
  getStatus: () => McpServerStatus;
};

const actions: Action[] = [];

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

function showStatus(status: McpServerStatus): void {
  const state = tl(`mcp.server_controls.state_${status.state}`);
  const authentication = tl(
    status.authenticationEnabled
      ? "mcp.server_controls.authentication_enabled"
      : "mcp.server_controls.authentication_disabled"
  );
  Blockbench.showMessageBox({
    title: tl("mcp.server_controls.status_title"),
    message: [
      `${tl("mcp.server_controls.status_state")}: ${state}`,
      `${tl("mcp.server_controls.status_address")}: ${status.url}`,
      `${tl("mcp.server_controls.status_authentication")}: ${authentication}`,
      `${tl("mcp.server_controls.status_clients")}: ${status.connectedClients}`,
    ].join("\n"),
    icon: status.state === "running" ? "check_circle" : "info",
    buttons: ["dialog.ok"],
  });
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
}

export function serverControlsTeardown(): void {
  actions.splice(0).forEach((action) => action.delete());
}
