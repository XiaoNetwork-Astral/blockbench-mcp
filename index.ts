/**
 * @author jasonjgardner
 * @discord jason.gardner
 * @github https://github.com/jasonjgardner
 */
/// <reference types="three" />
/// <reference types="blockbench-types" />
import { PLUGIN_ID, VERSION } from "@/lib/constants";
import { createServer } from "@/server/server";
import { tools } from "@/server/tools";
import { resources } from "@/server";
import { uiSetup, uiTeardown } from "@/ui";
import { settingsSetup, settingsTeardown } from "@/ui/settings";
import { setupI18n } from "@/ui/i18n";
import { sessionManager } from "@/lib/sessions";
import type { NetServer, SessionTransports } from "@/server/net";
import createNetServer, { stopNetServer } from "@/server/net";
import { setupYsmWorkspaceUi, teardownYsmWorkspaceUi } from "@/lib/ysmWorkspace";
import { auditManager } from "@/lib/audit";
import { setupProjectProtection, teardownProjectProtection } from "@/lib/projectProtection";
import {
  getMcpEndpoint,
  getMcpAuthToken,
  getMcpBindHost,
  getMcpPort,
  getSessionTimeoutMinutes,
  getSseHeartbeatSeconds,
} from "@/lib/pluginSettings";
import { isLoopbackMcpHost } from "@/lib/security";
import { getIcon } from "@/macros/getIcon" with { type: "macro" };

let httpServer: NetServer | null = null;
let sessionTransports: SessionTransports | null = null;

BBPlugin.register(PLUGIN_ID, {
  version: VERSION,
  title: "Codex Blockbench MCP",
  author: "Jason J. Gardner and OpenAI Codex",
  contributors: ["jasonjgardner", "brokestar233", "OpenAI Codex"],
  description:
    "Local-first MCP server with direct Blockbench modeling, protected project tabs, and folder-scoped YSM synchronization.",
  tags: ["MCP", "AI"],
  icon: getIcon(),
  variant: "desktop",
  async onload() {
    // Initialize Blockbench-native UI and audit storage before opening the
    // MCP server. The operations panel remains available even when the
    // user declines network permission or the port cannot be opened.
    setupI18n();
    settingsSetup();
    setupYsmWorkspaceUi();
    auditManager.setup();
    setupProjectProtection();
    const referenceServer = createServer();
    uiSetup({
      server: referenceServer,
      tools,
      resources,
    });

    // Get network module with Blockbench permission handling
    // @ts-ignore - requireNativeModule is a Blockbench global
    const net = requireNativeModule("net", {
      message: "Network access is required for the MCP server to accept connections.",
      detail: "The MCP plugin needs to create a local server that AI assistants can connect to.",
      optional: false,
    });

    if (!net) {
      console.error("[MCP] Failed to get net module - server will not start");
      Blockbench.showQuickMessage("MCP Server requires network permission", 3000);
      return;
    }

    // Create TCP server to handle HTTP requests
    const host = getMcpBindHost();
    const sessionTimeoutMin = getSessionTimeoutMinutes();
    const sseHeartbeatSec = getSseHeartbeatSeconds();
    if (!isLoopbackMcpHost(host)) {
      console.warn(
        `[Codex MCP] Listening on non-loopback address "${host}". ` +
        "The server may be reachable from other devices; Bearer authentication remains required."
      );
      Blockbench.showQuickMessage(tl("mcp.settings.bind_host_active_warning", [host]), 7000);
    }
    [httpServer, sessionTransports] = createNetServer(net, {
      host,
      port: getMcpPort(),
      endpoint: getMcpEndpoint(),
      authToken: getMcpAuthToken(),
      keepAlive: {
        sseHeartbeatIntervalMs: Math.max(0, sseHeartbeatSec) * 1000,
      },
      sessionConfig: {
        inactivityTimeoutMs: Math.max(1, sessionTimeoutMin) * 60 * 1000,
      },
    });

  },

  onunload() {
    const serverToStop = httpServer;
    const transportsToStop = sessionTransports;
    httpServer = null;
    sessionTransports = null;
    auditManager.teardown();
    teardownProjectProtection();
    if (serverToStop && transportsToStop) {
      void stopNetServer(serverToStop, transportsToStop, 5000)
        .catch((error) => {
          console.error("[Codex MCP] Failed to stop server cleanly:", error);
        });
    } else {
      sessionManager.clear();
    }

    uiTeardown();
    settingsTeardown();
    teardownYsmWorkspaceUi();
  },

  oninstall() {
    Blockbench.showQuickMessage("Installed Codex Blockbench MCP", 2000);
  },

  onuninstall() {
    Blockbench.showQuickMessage("Uninstalled Codex Blockbench MCP", 2000);
    settingsTeardown();
    teardownYsmWorkspaceUi();
  },
});
