import { afterEach, describe, expect, test } from "bun:test";
import { request as httpRequest } from "node:http";
import { connect, createServer } from "node:net";
import {
  createStatelessHttpServer,
  type StatelessHttpRuntime,
} from "@/server/http";

const runtimes: StatelessHttpRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
});

async function start(
  token: string,
  handler: Parameters<typeof createStatelessHttpServer>[2],
  requestTimeoutMs?: number
): Promise<number> {
  const runtime = createStatelessHttpServer(
    { createServer },
    {
      host: "127.0.0.1",
      port: 0,
      endpoint: "/bb-mcp",
      authToken: token,
      requestTimeoutMs,
    },
    handler
  );
  runtimes.push(runtime);
  await new Promise<void>((resolve) => runtime.server.once("listening", resolve));
  const address = runtime.server.address();
  if (!address || typeof address === "string") throw new Error("Missing test address");
  return address.port;
}

async function call(
  port: number,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const body = options.body === undefined ? "" : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path,
      method: options.method ?? "GET",
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

describe("stateless HTTP boundary", () => {
  test("requires the configured bearer token", async () => {
    const port = await start("secret-token", async () => new Response(null, { status: 204 }));
    const denied = await call(port, "/bb-mcp", { method: "POST", body: {} });
    expect(denied.status).toBe(401);
    expect(denied.headers["www-authenticate"]).toContain("Bearer");
  });

  test("handles each POST independently and has no session header contract", async () => {
    const bodies: unknown[] = [];
    const port = await start("", async (_request, parsedBody) => {
      bodies.push(parsedBody);
      return Response.json({ ok: true });
    });

    const first = await call(port, "/bb-mcp", { method: "POST", body: { id: 1 } });
    const second = await call(port, "/bb-mcp", { method: "POST", body: { id: 2 } });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers["mcp-session-id"]).toBeUndefined();
    expect(bodies).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("keeps health checks small and rejects non-POST MCP requests", async () => {
    const port = await start("", async () => new Response(null, { status: 204 }));
    expect(JSON.parse((await call(port, "/health")).body)).toEqual({ status: "ok" });
    expect((await call(port, "/bb-mcp")).status).toBe(405);
    expect((await call(port, "/elsewhere")).status).toBe(404);
  });

  test("serves UTF-8 responses through Blockbench's supported net module", async () => {
    const port = await start("", async () => Response.json({ message: "模型已更新" }));
    const response = await call(port, "/bb-mcp", { method: "POST", body: { id: 1 } });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ message: "模型已更新" });
    expect(response.headers.connection).toBe("close");
  });

  test("uses the timeout for incomplete uploads but not accepted handlers", async () => {
    const port = await start("", async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return Response.json({ completed: true });
    }, 20);

    const response = await call(port, "/bb-mcp", { method: "POST", body: { id: 1 } });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ completed: true });

    const partialClosed = await new Promise<boolean>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      const guard = setTimeout(() => {
        socket.destroy();
        reject(new Error("Incomplete request was not closed by its upload timeout."));
      }, 500);
      socket.on("connect", () => {
        socket.write("POST /bb-mcp HTTP/1.1\r\nContent-Length: 100\r\n\r\n{}");
      });
      socket.on("close", () => {
        clearTimeout(guard);
        resolve(true);
      });
      socket.on("error", (error) => {
        clearTimeout(guard);
        reject(error);
      });
    });
    expect(partialClosed).toBe(true);
  });
});
