/**
 * @author jasonjgardner
 * @discord jason.gardner
 * @github https://github.com/jasonjgardner
 */
/// <reference types="three" />
/// <reference types="blockbench-types" />
import { PLUGIN_ID, VERSION } from "@/lib/constants";
import { tools } from "@/server/tools";
import "@/server/resources";
import "@/server/prompts";
import { uiSetup, uiTeardown } from "@/ui";
import { settingsSetup, settingsTeardown } from "@/ui/settings";
import { setupI18n } from "@/ui/i18n";
import {
  serverControlsSetup,
  serverControlsTeardown,
  type McpServerStatus,
} from "@/ui/serverControls";
import {
  getMcpServerState,
  setMcpServerState,
} from "@/lib/serverRuntime";
import { sessionManager } from "@/lib/sessions";
import type { NetServer, SessionTransports } from "@/server/net";
import createNetServer, { stopNetServer } from "@/server/net";
import { teardownPluginWorkspace } from "@/lib/pluginWorkspace";
import { auditManager } from "@/lib/audit";
import { setupProjectProtection, teardownProjectProtection } from "@/lib/projectProtection";
import {
  getMcpEndpoint,
  getMcpAuthToken,
  getMcpBindHost,
  getMcpPort,
  getSessionTimeoutMinutes,
  getSseHeartbeatSeconds,
  formatMcpHostForUrl,
} from "@/lib/pluginSettings";
import { isLoopbackMcpHost } from "@/lib/security";
import { initPromptLoader } from "@/lib/promptLoader";
import { getIcon } from "@/macros/getIcon" with { type: "macro" };

let httpServer: NetServer | null = null;
let sessionTransports: SessionTransports | null = null;
let netModule: Parameters<typeof createNetServer>[0] | null = null;
let stoppingServer: Promise<void> | null = null;
let pluginLoaded = false;
let activeServerUrl: string | null = null;
let activeAuthenticationEnabled: boolean | null = null;

function currentServerUrl(): string {
  return `http://${formatMcpHostForUrl(getMcpBindHost())}:${getMcpPort()}${getMcpEndpoint()}`;
}

function getServerStatus(): McpServerStatus {
  return {
    state: getMcpServerState(),
    url: activeServerUrl ?? currentServerUrl(),
    authenticationEnabled: activeAuthenticationEnabled ?? Boolean(getMcpAuthToken()),
    connectedClients: sessionManager.getClientCount(),
    connectedSessions: sessionManager.getCount(),
  };
}

function warnAboutServerExposure(host: string, authToken: string): void {
  const loopback = isLoopbackMcpHost(host);
  if (!authToken) {
    const key = loopback
      ? "mcp.settings.auth_disabled_active_warning"
      : "mcp.settings.auth_disabled_network_active_warning";
    console.warn(
      loopback
        ? "[Blockbench MCP] Bearer authentication is disabled. Keep the server bound to loopback unless unauthenticated network access is intentional."
        : `[Blockbench MCP] Bearer authentication is disabled while listening on non-loopback address "${host}". The server may be reachable without credentials.`
    );
    Blockbench.showQuickMessage(tl(key, [host]), 8000);
    return;
  }

  if (!loopback) {
    console.warn(
      `[Blockbench MCP] Listening on non-loopback address "${host}". ` +
      "The server may be reachable from other devices; Bearer authentication is enabled."
    );
    Blockbench.showQuickMessage(tl("mcp.settings.bind_host_active_warning", [host]), 7000);
  }
}

async function startMcpServer(showFeedback = true): Promise<void> {
  if (stoppingServer) await stoppingServer;
  if (httpServer || getMcpServerState() === "starting") {
    if (showFeedback) Blockbench.showQuickMessage(tl("mcp.server_controls.already_running"), 2500);
    return;
  }
  if (!netModule) {
    Blockbench.showQuickMessage(tl("mcp.server_controls.network_unavailable"), 3500);
    return;
  }

  setMcpServerState("starting");
  const host = getMcpBindHost();
  const authToken = getMcpAuthToken();
  const sessionTimeoutMin = getSessionTimeoutMinutes();
  const sseHeartbeatSec = getSseHeartbeatSeconds();
  warnAboutServerExposure(host, authToken);

  try {
    const [server, transports] = createNetServer(netModule, {
      host,
      port: getMcpPort(),
      endpoint: getMcpEndpoint(),
      authToken,
      keepAlive: {
        sseHeartbeatIntervalMs: Math.max(0, sseHeartbeatSec) * 1000,
      },
      sessionConfig: {
        inactivityTimeoutMs: Math.max(1, sessionTimeoutMin) * 60 * 1000,
      },
    });
    httpServer = server;
    sessionTransports = transports;
    activeServerUrl = `http://${formatMcpHostForUrl(host)}:${getMcpPort()}${getMcpEndpoint()}`;
    activeAuthenticationEnabled = Boolean(authToken);

    server.once("listening", () => {
      if (httpServer === server) {
        setMcpServerState("running");
        if (showFeedback && pluginLoaded) {
          Blockbench.showQuickMessage(
            tl("mcp.server_controls.started", [activeServerUrl ?? currentServerUrl()]),
            3500
          );
        }
      }
    });
    server.once("close", () => {
      if (httpServer === server) {
        httpServer = null;
        sessionTransports = null;
        setMcpServerState("stopped");
        activeServerUrl = null;
        activeAuthenticationEnabled = null;
      }
    });
    server.on("error", () => {
      if (httpServer === server && !server.listening) {
        httpServer = null;
        sessionTransports = null;
        setMcpServerState("stopped");
        activeServerUrl = null;
        activeAuthenticationEnabled = null;
      }
    });

    if (showFeedback) {
      Blockbench.showQuickMessage(tl("mcp.server_controls.starting"), 2200);
    }
  } catch (error) {
    setMcpServerState("stopped");
    activeServerUrl = null;
    activeAuthenticationEnabled = null;
    throw error;
  }
}

async function stopMcpServer(showFeedback = true): Promise<void> {
  if (stoppingServer) return stoppingServer;
  const serverToStop = httpServer;
  const transportsToStop = sessionTransports;
  if (!serverToStop || !transportsToStop) {
    setMcpServerState("stopped");
    if (showFeedback) Blockbench.showQuickMessage(tl("mcp.server_controls.already_stopped"), 2500);
    return;
  }

  httpServer = null;
  sessionTransports = null;
  setMcpServerState("stopping");
  stoppingServer = stopNetServer(serverToStop, transportsToStop, 5000)
    .then(() => {
      if (showFeedback && pluginLoaded) {
        Blockbench.showQuickMessage(tl("mcp.server_controls.stopped"), 2500);
      }
    })
    .finally(() => {
      setMcpServerState("stopped");
      activeServerUrl = null;
      activeAuthenticationEnabled = null;
      stoppingServer = null;
    });
  return stoppingServer;
}

BBPlugin.register(PLUGIN_ID, {
  version: VERSION,
  title: "Blockbench MCP",
  author: "Jason J. Gardner and OpenAI Codex",
  contributors: ["jasonjgardner", "brokestar233", "OpenAI Codex"],
  description:
    "Local-first MCP server with direct Blockbench modeling, protected project tabs, and folder-scoped YSM synchronization.",
  tags: ["MCP", "AI"],
  icon: getIcon(),
  variant: "desktop",
  async onload() {
    pluginLoaded = true;
    // Initialize Blockbench-native UI and audit storage before opening the
    // MCP server. The operations panel remains available even when the
    // user declines network permission or the port cannot be opened.
    setupI18n();
    settingsSetup();
    try {
      await initPromptLoader();
    } catch (error) {
      console.error("[Blockbench MCP] Failed to load bundled prompts:", error);
    }
    auditManager.setup();
    setupProjectProtection();
    uiSetup({ tools });
    serverControlsSetup({
      start: () => startMcpServer(true),
      stop: () => stopMcpServer(true),
      getStatus: getServerStatus,
    });

    // Get network module with Blockbench permission handling
    // @ts-ignore - requireNativeModule is a Blockbench global
    netModule = requireNativeModule("net", {
      message: "Network access is required for the MCP server to accept connections.",
      detail: "The MCP plugin needs to create a local server that AI assistants can connect to.",
      optional: false,
    }) as Parameters<typeof createNetServer>[0] | null;

    if (!netModule) {
      console.error("[MCP] Failed to get net module - server will not start");
      Blockbench.showQuickMessage(tl("mcp.server_controls.network_unavailable"), 3000);
      return;
    }
    await startMcpServer(false);
  },

  onunload() {
    pluginLoaded = false;
    serverControlsTeardown();
    auditManager.teardown();
    teardownProjectProtection();
    void stopMcpServer(false).catch((error) => {
      console.error("[Blockbench MCP] Failed to stop server cleanly:", error);
    });
    netModule = null;
    if (!httpServer && !stoppingServer) sessionManager.clear();

    uiTeardown();
    settingsTeardown();
    teardownPluginWorkspace();
  },

  oninstall() {
  },

  onuninstall() {
    settingsTeardown();
    serverControlsTeardown();
    teardownPluginWorkspace();
  },
});
