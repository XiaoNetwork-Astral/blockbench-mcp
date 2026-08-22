import { afterEach, describe, expect, test } from "bun:test";
import {
  SessionManager,
  getSessionClientKey,
  type SessionClientMetadata,
} from "@/lib/sessions";

const managers: SessionManager[] = [];

function createManager(): SessionManager {
  const manager = new SessionManager();
  manager.configure({ pingIntervalMs: 0, inactivityTimeoutMs: 60_000 });
  managers.push(manager);
  return manager;
}

afterEach(() => {
  managers.splice(0).forEach((manager) => manager.clear());
});

describe("MCP session and client accounting", () => {
  test("groups repeated sessions from one reported client", () => {
    const manager = createManager();
    const metadata: SessionClientMetadata = {
      clientName: "Codex",
      clientVersion: "1.0",
      remoteAddress: "::ffff:127.0.0.1",
      userAgent: "codex-app/1.0",
    };

    expect(manager.add("session-a", metadata)).toBe(true);
    expect(manager.add("session-b", { ...metadata, remoteAddress: "127.0.0.1" })).toBe(true);

    expect(manager.getCount()).toBe(2);
    expect(manager.getClientCount()).toBe(1);
    expect(manager.getClients()[0].sessions.map((session) => session.id).sort()).toEqual([
      "session-a",
      "session-b",
    ]);
  });

  test("keeps distinct reported clients separate", () => {
    const manager = createManager();
    manager.add("codex", {
      clientName: "Codex",
      remoteAddress: "127.0.0.1",
      userAgent: "codex-app",
    });
    manager.add("inspector", {
      clientName: "MCP Inspector",
      remoteAddress: "127.0.0.1",
      userAgent: "inspector",
    });

    expect(manager.getClientCount()).toBe(2);
  });

  test("disconnects individual sessions and whole logical clients through the transport callback", async () => {
    const manager = createManager();
    const closed: string[] = [];
    manager.setRemovalCallback(async (sessionId) => {
      await Promise.resolve();
      closed.push(sessionId);
    });
    const metadata = {
      clientName: "Codex",
      remoteAddress: "127.0.0.1",
      userAgent: "codex-app",
    };
    manager.add("session-a", metadata);
    manager.add("session-b", metadata);

    expect(manager.disconnectSession("session-a")).toBe(true);
    expect(manager.disconnectSession("missing")).toBe(false);
    expect(manager.disconnectClient(getSessionClientKey(metadata))).toBe(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.getCount()).toBe(0);
    expect(closed.sort()).toEqual(["session-a", "session-b"]);
  });

  test("temporarily blocks a reported identity and disconnects its current sessions", async () => {
    const manager = createManager();
    const closed: string[] = [];
    manager.setRemovalCallback((sessionId) => {
      closed.push(sessionId);
    });
    const metadata = {
      clientName: "Codex",
      clientVersion: "1.2.3",
      remoteAddress: "127.0.0.1",
      userAgent: "codex-app",
    };
    manager.add("session-a", metadata);
    manager.add("session-b", metadata);

    const blocked = manager.blockClient(getSessionClientKey(metadata));
    await Promise.resolve();

    expect(blocked?.clientName).toBe("Codex");
    expect(manager.getCount()).toBe(0);
    expect(closed.sort()).toEqual(["session-a", "session-b"]);
    expect(manager.isClientBlocked(metadata)).toBe(true);
    expect(manager.add("session-c", metadata)).toBe(false);
    expect(manager.unblockClient(getSessionClientKey(metadata))).toBe(true);
    expect(manager.add("session-c", metadata)).toBe(true);
  });

  test("pong health checks do not impersonate client activity", () => {
    const manager = createManager();
    manager.add("session-a");
    const before = manager.get("session-a")?.lastActivity.getTime();

    manager.recordPongReceived("session-a");

    expect(manager.get("session-a")?.lastActivity.getTime()).toBe(before);
    expect(manager.get("session-a")?.lastPongAt).toBeInstanceOf(Date);
  });
});
