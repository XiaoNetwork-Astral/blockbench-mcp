import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Server, Socket } from "node:net";
import { createServer as createMcpServer } from "@/server/server";
import {
  registerPromptsOnServer,
  registerResourcesOnServer,
  registerToolsOnServer,
} from "@/lib/factories";
import { isAuthorizedMcpRequest } from "@/lib/security";
import { formatMcpHostForUrl } from "@/lib/pluginSettings";

type NetModule = {
  createServer(listener: (socket: Socket) => void): Server;
};

export type StatelessHttpOptions = {
  host: string;
  port: number;
  endpoint: string;
  authToken: string;
  /** Time allowed to finish sending one request. The response handler is not timed out. */
  requestTimeoutMs?: number;
};

export type StatelessHttpRuntime = {
  server: Server;
  getActiveRequestCount(): number;
  stop(): Promise<void>;
};

export type McpRequestHandler = (
  request: Request,
  parsedBody: unknown
) => Promise<Response>;

type ParsedRequest =
  | { request: Request }
  | { response: Response };

function jsonResponse(status: number, value: unknown, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json");
  return new Response(JSON.stringify(value), {
    status,
    headers: responseHeaders,
  });
}

function rpcError(status: number, message: string): Response {
  return jsonResponse(status, {
    jsonrpc: "2.0",
    error: { code: status === 400 ? -32700 : -32600, message },
    id: null,
  });
}

function requestHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return headers;
}

export function createHttpRequestHandler(
  options: Pick<StatelessHttpOptions, "endpoint" | "authToken">,
  handleMcpRequest: McpRequestHandler
): (request: Request) => Promise<Response> {
  return async (request) => {
    const pathname = new URL(request.url).pathname;
    const headers = requestHeaders(request);

    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      return jsonResponse(403, { error: "Origin is not allowed." });
    }

    if (!isAuthorizedMcpRequest(headers, options.authToken)) {
      return jsonResponse(401, { error: "Unauthorized" }, {
        "www-authenticate": 'Bearer realm="Blockbench MCP"',
      });
    }

    if (pathname === "/health" || pathname === `${options.endpoint}/health`) {
      return jsonResponse(200, { status: "ok" });
    }

    if (pathname === "/ready" || pathname === `${options.endpoint}/ready`) {
      return jsonResponse(200, { ready: true });
    }

    if (pathname !== options.endpoint) {
      return new Response("Not Found", { status: 404 });
    }

    if (request.method !== "POST") {
      return rpcError(405, "Method not allowed.");
    }

    let body: unknown;
    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : undefined;
    } catch {
      return rpcError(400, "Invalid JSON request body.");
    }

    try {
      return await handleMcpRequest(request, body);
    } catch (error) {
      console.error("[Blockbench MCP] Request failed:", error);
      return rpcError(500, "Internal server error.");
    }
  };
}

function createProtocolHandler() {
  return createMcpHandler(() => {
    const server = createMcpServer();
    registerToolsOnServer(server);
    registerResourcesOnServer(server);
    registerPromptsOnServer(server);
    return server;
  }, { legacy: "stateless" });
}

function parseRequest(
  buffer: Buffer,
  baseUrl: string,
  signal: AbortSignal
): ParsedRequest | null {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) return buffer.length > 65_536 ? { response: rpcError(413, "HTTP headers are too large.") } : null;
  if (headerEnd > 65_536) return { response: rpcError(413, "HTTP headers are too large.") };

  const lines = buffer.subarray(0, headerEnd).toString("utf8").split("\r\n");
  const [method, target, protocol] = lines[0]?.split(" ") ?? [];
  if (!method || !target?.startsWith("/") || target.startsWith("//") || target.includes("\\") || protocol !== "HTTP/1.1") {
    return { response: rpcError(400, "Invalid HTTP request.") };
  }

  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(":");
    if (separator < 1) {
      return { response: rpcError(400, "Invalid HTTP header.") };
    }
    const name = line.slice(0, separator).trim().toLowerCase();
    if (Object.hasOwn(headers, name)) return { response: rpcError(400, "Duplicate HTTP header.") };
    headers[name] = line.slice(separator + 1).trim();
  }

  if (headers["transfer-encoding"] && headers["transfer-encoding"].toLowerCase() !== "identity") {
    return { response: rpcError(400, "Chunked request bodies are not supported.") };
  }

  const contentLengthText = headers["content-length"] ?? "0";
  const contentLength = Number(contentLengthText);
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    return { response: rpcError(400, "Invalid Content-Length header.") };
  }
  if (contentLength > 32 * 1024 * 1024) return { response: rpcError(413, "Request body exceeds 32 MiB.") };

  const bodyStart = headerEnd + 4;
  if (buffer.length < bodyStart + contentLength) return null;

  try {
    const url = new URL(target, baseUrl);
    const body = buffer.subarray(bodyStart, bodyStart + contentLength);
    return {
      request: new Request(url, {
        method,
        headers,
        signal,
        body: method === "GET" || method === "HEAD" || body.length === 0
          ? undefined
          : body.toString("utf8"),
      }),
    };
  } catch {
    return { response: rpcError(400, "Invalid HTTP request target.") };
  }
}

function statusText(status: number): string {
  const names: Record<number, string> = {
    200: "OK",
    204: "No Content",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    413: "Content Too Large",
    500: "Internal Server Error",
  };
  return names[status] ?? "Response";
}

async function writeResponse(socket: Socket, response: Response): Promise<void> {
  const headers = new Headers(response.headers);
  // Close-delimited HTTP keeps SSE streaming without buffering the complete response.
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.set("connection", "close");
  if (!headers.has("date")) headers.set("date", new Date().toUTCString());

  let head = `HTTP/1.1 ${response.status} ${response.statusText || statusText(response.status)}\r\n`;
  headers.forEach((value, name) => {
    head += `${name}: ${value}\r\n`;
  });
  head += "\r\n";

  socket.write(head);
  const reader = response.body?.getReader();
  if (!reader) { socket.end(); return; }
  const cancel = () => { void reader.cancel().catch(() => { }); };
  socket.once("close", cancel);
  try {
    while (!socket.destroyed) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!socket.write(value)) {
        await new Promise<void>((resolve, reject) => {
          const clean = () => { socket.off("drain", drained); socket.off("close", drained); socket.off("error", failed); };
          const drained = () => { clean(); resolve(); };
          const failed = (error: Error) => { clean(); reject(error); };
          socket.once("drain", drained); socket.once("close", drained); socket.once("error", failed);
        });
      }
    }
    socket.end();
  } finally {
    socket.off("close", cancel);
    await reader.cancel().catch(() => { });
    reader.releaseLock();
  }
}

export function createStatelessHttpServer(
  net: NetModule,
  options: StatelessHttpOptions,
  handleMcpRequest?: McpRequestHandler
): StatelessHttpRuntime {
  const protocolHandler = handleMcpRequest ? undefined : createProtocolHandler();
  const dispatch: McpRequestHandler = handleMcpRequest ?? ((request, parsedBody) =>
    protocolHandler!.fetch(request, { parsedBody }));
  let stopping: Promise<void> | null = null;
  const sockets = new Set<Socket>();
  const busySockets = new Set<Socket>();
  const subscriptionSockets = new Set<Socket>();
  const baseUrl =
    `http://${formatMcpHostForUrl(options.host)}:${options.port || 80}`;

  const server = net.createServer((socket) => {
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    let accepted = false;
    const abort = new AbortController();
    const handleRequest = createHttpRequestHandler(options, (request, body) => {
      if ((body as { method?: string } | undefined)?.method === "subscriptions/listen") subscriptionSockets.add(socket);
      return dispatch(request, body);
    });

    socket.setTimeout(options.requestTimeoutMs ?? 30_000, () => socket.destroy());
    socket.on("data", (chunk: Buffer) => {
      if (accepted) return;
      buffer = Buffer.concat([buffer, chunk]);
      const parsed = parseRequest(buffer, baseUrl, abort.signal);
      if (!parsed) return;

      accepted = true;
      buffer = Buffer.alloc(0);
      socket.setTimeout(0);
      busySockets.add(socket);
      const response = "response" in parsed
        ? Promise.resolve(parsed.response)
        : handleRequest(parsed.request);

      void response
        .then((result) => writeResponse(socket, result))
        .catch((error) => {
          console.error("[Blockbench MCP] HTTP response failed:", error);
          if (!socket.destroyed && socket.bytesWritten === 0) {
            return writeResponse(socket, rpcError(500, "Internal server error."));
          }
          socket.destroy();
        })
        .finally(() => {
          busySockets.delete(socket);
          subscriptionSockets.delete(socket);
        });
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "ECONNRESET") {
        console.error("[Blockbench MCP] Socket error:", error.message);
      }
    });
    socket.on("close", () => {
      abort.abort();
      sockets.delete(socket);
      busySockets.delete(socket);
      subscriptionSockets.delete(socket);
      buffer = Buffer.alloc(0);
    });
  });

  server.listen(options.port, options.host);

  return {
    server,
    getActiveRequestCount: () => busySockets.size - subscriptionSockets.size,
    stop() {
      if (stopping) return stopping;
      for (const socket of sockets) {
        if (!busySockets.has(socket) || subscriptionSockets.has(socket)) socket.destroy();
      }
      if (!server.listening) return protocolHandler?.close() ?? Promise.resolve();

      stopping = new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      }).then(() => protocolHandler?.close());
      return stopping;
    },
  };
}
