import { describe, expect, test } from "bun:test";
import { toolRequestExtraForSession } from "@/lib/factories";

describe("per-session tool routing", () => {
  test("uses the transport session id instead of a shared default context", () => {
    const first = toolRequestExtraForSession(
      { requestId: "one" },
      () => "session-a"
    ) as { requestId?: string; sessionId?: string };
    const second = toolRequestExtraForSession(
      { requestId: "two", sessionId: "stale" },
      () => "session-b"
    ) as { requestId?: string; sessionId?: string };

    expect(first).toEqual({ requestId: "one", sessionId: "session-a" });
    expect(second).toEqual({ requestId: "two", sessionId: "session-b" });
  });
});
