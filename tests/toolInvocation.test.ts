import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { defineTool, registerToolOnServer, registerResourcesOnServer, type ToolDefinition } from "@/lib/factories";
import { auditManager } from "@/lib/audit";
import { setProjectReadOnly } from "@/src/features/readOnly/service";

const connections: Array<{ client: Client; server: McpServer }> = [];
const savedGlobals = new Map<string, PropertyDescriptor | undefined>();
let beginAudit: ReturnType<typeof spyOn<typeof auditManager, "beginMcpOperation">>;
let finishAudit: ReturnType<typeof spyOn<typeof auditManager, "finishMcpOperation">>;

beforeEach(() => {
  beginAudit = spyOn(auditManager, "beginMcpOperation").mockReturnValue({} as ReturnType<typeof auditManager.beginMcpOperation>);
  finishAudit = spyOn(auditManager, "finishMcpOperation").mockImplementation(() => { });
  for (const key of ["Undo", "ModelProject", "Blockbench", "Plugins", "localStorage"]) {
    savedGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
});

afterEach(async () => {
  for (const { client, server } of connections.splice(0)) {
    await client.close();
    await server.close();
  }
  beginAudit.mockRestore();
  finishAudit.mockRestore();
  for (const [key, descriptor] of savedGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  savedGlobals.clear();
});

function setGlobal(key: string, value: unknown): void {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

async function connectTool(tool: ToolDefinition): Promise<Client> {
  const server = new McpServer({ name: "tool-test", version: "1" });
  registerToolOnServer(server, tool);
  const client = new Client({ name: "test-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  connections.push({ client, server });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("registered tool execution", () => {
  test("resource reads require the project named in the URI to remain visible", async () => {
    const node = { uuid: "node-id", name: "Node", position: { toArray: () => [1, 2, 3] }, rotation: { toArray: () => [0, 0, 0] }, scale: { toArray: () => [1, 1, 1] } };
    const visible = { uuid: "visible-project", name: "Visible", selected: true, nodes_3d: { node } };
    const background = { uuid: "other-project", name: "Other", selected: false, get nodes_3d() { throw new Error("Background project was read"); } };
    setGlobal("ModelProject", { all: [visible, background] });
    setGlobal("Plugins", { installed: [] });
    await import("@/server/resources");
    const server = new McpServer({ name: "resource-test", version: "1" });
    registerResourcesOnServer(server);
    const client = new Client({ name: "resource-client", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    connections.push({ client, server });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await expect(client.readResource({ uri: "nodes://other-project/node-id" })).rejects.toThrow(/not the visible tab/);
    const response = await client.readResource({ uri: "nodes://visible-project/node-id" });
    expect(JSON.parse((response.contents[0] as { text: string }).text).position).toEqual([1, 2, 3]);
    expect(visible.selected).toBe(true);
    expect(background.selected).toBe(false);
  });

  test("validates cross-field rules and applies defaults through the SDK", async () => {
    const schema = z.object({
      first: z.string().optional(),
      second: z.string().optional(),
      limit: z.number().default(3),
    }).refine(({ first, second }) => Boolean(first || second), {
      message: "Provide first or second.",
    });
    const received: unknown[] = [];
    const client = await connectTool(defineTool({
      name: "validate", description: "Validation probe", status: "stable", project: "none",
      annotations: { readOnlyHint: true }, parameters: schema,
      async execute(args) { received.push(args); return JSON.stringify(args); },
    }));
    const invalid = await client.callTool({ name: "validate", arguments: {} });
    expect(invalid.isError).toBe(true);
    expect(received).toEqual([]);
    const valid = await client.callTool({ name: "validate", arguments: { first: "value" } });
    expect(valid.isError).not.toBe(true);
    expect(received).toEqual([{ first: "value", limit: 3 }]);
  });

  test("blocks a registered mutation on a read-only visible project", async () => {
    const project = { uuid: "locked-test", name: "Locked", selected: true } as ModelProject;
    setGlobal("ModelProject", { all: [project] });
    setGlobal("Blockbench", { Project: project });
    setGlobal("localStorage", undefined);
    setProjectReadOnly(project, true);
    let executed = false;
    const client = await connectTool(defineTool({
      name: "mutate", description: "Mutation probe", status: "stable", parameters: z.object({}),
      async execute() { executed = true; return "changed"; },
    }));
    const result = await client.callTool({ name: "mutate", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("read-only");
    expect(executed).toBe(false);
  });

  test("rolls back only an Undo edit opened by the failed invocation", async () => {
    const originalEdit = {};
    const undo = { current_save: originalEdit, cancelEdit: (_revert: boolean) => { cancelled++; } };
    let cancelled = 0;
    setGlobal("Undo", undo);
    const client = await connectTool(defineTool({
      name: "fail", description: "Rollback probe", status: "stable", project: "none",
      parameters: z.object({ open_edit: z.boolean() }),
      async execute({ open_edit }) {
        if (open_edit) undo.current_save = {};
        throw new Error("Test failure");
      },
    }));
    expect((await client.callTool({ name: "fail", arguments: { open_edit: false } })).isError).toBe(true);
    expect(cancelled).toBe(0);
    expect((await client.callTool({ name: "fail", arguments: { open_edit: true } })).isError).toBe(true);
    expect(cancelled).toBe(1);
  });
});
