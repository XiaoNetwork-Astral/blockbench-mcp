import {
  sessionManager,
  type BlockedClient,
  type ClientSummary,
  type SessionClientMetadata,
} from "@/lib/sessions";
import clientManagerCss from "@/ui/clientManager.css";
import template from "@/ui/clientManager.html";

let clientManagerDialog: Dialog | undefined;
let cssHandle: { delete(): void } | undefined;

type ManagedSession = {
  id: string;
  connectedAt: Date;
  lastActivity: Date;
  requestCount: number;
};

type ManagedClient = Omit<ClientSummary, "sessions"> & {
  sessions: ManagedSession[];
};

function getManagedClients(): ManagedClient[] {
  // Never hand Vue the internal Session objects: they contain Node timer
  // handles, which are implementation details and can contain deep/circular
  // structures that a reactive observer should not traverse.
  return sessionManager.getClients().map((client) => ({
    key: client.key,
    clientName: client.clientName,
    clientVersion: client.clientVersion,
    remoteAddress: client.remoteAddress,
    userAgent: client.userAgent,
    connectedAt: client.connectedAt,
    lastActivity: client.lastActivity,
    sessions: client.sessions.map((session) => ({
      id: session.id,
      connectedAt: session.connectedAt,
      lastActivity: session.lastActivity,
      requestCount: session.requestCount,
    })),
  }));
}

function clientDisplayName(client: SessionClientMetadata): string {
  const name = client.clientName?.trim() || client.userAgent?.trim() || tl("mcp.client_manager.unknown_client");
  return client.clientVersion ? `${name} v${client.clientVersion}` : name;
}

function showBlockedConfirmation(client: ManagedClient, block: () => void): void {
  Blockbench.showMessageBox(
    {
      title: tl("mcp.client_manager.block_confirm_title"),
      message: tl("mcp.client_manager.block_confirm_message", [clientDisplayName(client)]),
      icon: "warning",
      buttons: [tl("mcp.client_manager.block_client"), tl("mcp.dialog.cancel")],
      confirm: 0,
      cancel: 1,
    },
    (button) => {
      if (button === 0) block();
    }
  );
}

export function showClientManager(): void {
  if (!cssHandle) cssHandle = Blockbench.addCSS(clientManagerCss);
  clientManagerDialog?.delete();

  clientManagerDialog = new Dialog({
    id: "codex_blockbench_mcp_client_manager",
    title: tl("mcp.client_manager.title"),
    icon: "devices",
    width: 780,
    resizable: "y",
    component: {
      name: "codex_blockbench_mcp_client_manager",
      data: () => ({
        clients: [] as ManagedClient[],
        blockedClients: [] as BlockedClient[],
        sessionCount: 0,
        unsubscribeSessions: null as (() => void) | null,
      }),
      mounted() {
        // @ts-ignore - Vue component context
        const vm = this;
        vm.unsubscribeSessions = sessionManager.subscribe(() => vm.refresh());
      },
      beforeDestroy() {
        // @ts-ignore - Vue component context
        this.unsubscribeSessions?.();
        // @ts-ignore - Vue component context
        this.unsubscribeSessions = null;
      },
      methods: {
        tl(key: string, variables?: string | number | (string | number)[]): string {
          return tl(key, variables);
        },
        refresh(): void {
          // @ts-ignore - Vue component context
          this.clients = getManagedClients();
          // @ts-ignore - Vue component context
          this.blockedClients = sessionManager.getBlockedClients();
          // @ts-ignore - Vue component context
          this.sessionCount = sessionManager.getCount();
        },
        formatClientName(client: SessionClientMetadata): string {
          return clientDisplayName(client);
        },
        formatSessionId(sessionId: string): string {
          return sessionId.length > 16
            ? `${sessionId.slice(0, 8)}…${sessionId.slice(-6)}`
            : sessionId;
        },
        formatTime(date: Date): string {
          return new Date(date).toLocaleTimeString();
        },
        disconnectSession(sessionId: string): void {
          if (sessionManager.disconnectSession(sessionId)) {
            Blockbench.showQuickMessage(tl("mcp.client_manager.session_disconnected"), 2200);
          }
        },
        disconnectClient(clientKey: string): void {
          const count = sessionManager.disconnectClient(clientKey);
          if (count > 0) {
            Blockbench.showQuickMessage(tl("mcp.client_manager.client_disconnected", [count]), 2500);
          }
        },
        confirmBlockClient(client: ManagedClient): void {
          showBlockedConfirmation(client, () => {
            if (sessionManager.blockClient(client.key)) {
              Blockbench.showQuickMessage(tl("mcp.client_manager.client_blocked"), 3000);
            }
          });
        },
        unblockClient(clientKey: string): void {
          if (sessionManager.unblockClient(clientKey)) {
            Blockbench.showQuickMessage(tl("mcp.client_manager.client_unblocked"), 2200);
          }
        },
      },
      template,
    },
    singleButton: true,
    buttons: [tl("mcp.audit.ok")],
  });
  clientManagerDialog.show();
}

export function clientManagerTeardown(): void {
  clientManagerDialog?.delete();
  clientManagerDialog = undefined;
  cssHandle?.delete();
  cssHandle = undefined;
}
