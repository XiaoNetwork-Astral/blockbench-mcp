import { sessionManager } from "@/lib/sessions";
import statusBarCSS from "@/ui/statusBar.css";

let statusBarElement: HTMLDivElement | undefined;
let unsubscribe: (() => void) | undefined;

export function statusBarSetup(): void {
  // Add CSS for the status bar
  Blockbench.addCSS(statusBarCSS);

  // Create the status bar element
  statusBarElement = document.createElement("div");
  statusBarElement.id = "mcp-status-bar";

  // Create the status indicator
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

  statusBarElement.appendChild(statusIndicator);

  // Function to update status based on sessions
  const updateStatus = () => {
    const clientCount = sessionManager.getClientCount();
    const sessionCount = sessionManager.getCount();
    if (clientCount > 0) {
      statusDot.classList.remove("disconnected");
      statusDot.classList.add("connected");
    } else {
      statusDot.classList.remove("connected");
      statusDot.classList.add("disconnected");
    }
    const clientUnit = tl(clientCount === 1
      ? "mcp.client_manager.client"
      : "mcp.client_manager.clients");
    const sessionUnit = tl(sessionCount === 1
      ? "mcp.client_manager.session"
      : "mcp.client_manager.sessions");
    statusText.textContent = tl("mcp.status.server");
    serverInfo.textContent = `(${clientCount} ${clientUnit} · ${sessionCount} ${sessionUnit})`;
  };

  // Subscribe to session changes
  unsubscribe = sessionManager.subscribe(updateStatus);

  // Append to the existing status bar
  const existingStatusBar = document.getElementById("status_bar");

  if (!existingStatusBar) {
    console.warn("Could not find status_bar element");
    return;
  }

  existingStatusBar.appendChild(statusBarElement);
}

export function statusBarTeardown(): void {
  // Unsubscribe from session changes
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = undefined;
  }

  if (statusBarElement) {
    statusBarElement.remove();
    statusBarElement = undefined;
  }
}
